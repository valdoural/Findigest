'use strict';
/**
 * Данные отчёта: синхронизация Zenmoney → расчёт (build.js) → сохранение готового набора в БД.
 * Окно получает набор через get(); после обновления окнам рассылается 'digest:updated'.
 */
const { BrowserWindow } = require('electron');
const D = require('../db/database');
const settings = require('../config/settings');
const secrets = require('../config/secrets');
const zen = require('../connectors/zenmoney');
const { build, BUILD_VERSION } = require('./build');
const log = require('../log');

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const stamp = iso => { const d = new Date(iso); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

let state = { running: false, lastError: null, lastRun: null };
const listeners = new Set();
const emit = () => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('digest:state', status()); listeners.forEach(f => f(status())); };

function save(data) {
  D.db.prepare(`INSERT INTO docs(collection,id,json,updated_at) VALUES('digest','data',?,?)
    ON CONFLICT(collection,id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at`).run(JSON.stringify(data), Date.now());
}
function stored() {
  const r = D.db.prepare("SELECT json FROM docs WHERE collection='digest' AND id='data'").get();
  return r ? JSON.parse(r.json) : null;
}

/** Пересчитать отчёт из базы (без сети). */
function rebuild() {
  if (!zen.hasData()) return null;
  const t0 = Date.now();
  const data = build(zen.load(localDate()));
  const last = settings.get().zenmoney.lastSync;
  data.syncedAt = last ? stamp(last) : null;
  save(data);
  log.info(`Отчёт пересчитан за ${Date.now() - t0} мс`);
  return data;
}

/** Данные для окна: если наступил новый день — пересчитываем (месяц, «сегодня», остатки дней). */
function get() {
  const s = stored();
  if (s && s.meta && s.meta.today === localDate() && s.version === BUILD_VERSION) return s;
  return rebuild() || s;
}

const zenReady = () => { const z = settings.get().zenmoney; return !!(z.enabled && secrets.get('zenmoney_token')); };
const mailReady = () => { const m = settings.get().mail; return !!(m.enabled && m.user && secrets.get('mail_password')); };

/**
 * Обновить: Zenmoney (синхронизация + пересчёт листов) и почта (новые чеки в архив).
 * only: 'zenmoney' | 'mail' — один источник. Ошибка одного источника не мешает другому.
 */
async function refresh({ full = false, reason = 'manual', only = null } = {}) {
  if (state.running) return status();
  const doZen = (!only || only === 'zenmoney') && zenReady();
  const doMail = (!only || only === 'mail') && mailReady();
  if (!doZen && !doMail) {
    const what = only === 'mail' ? 'Почта не подключена: укажите адрес и пароль приложения в «Подключениях»' : 'Zenmoney не подключён: добавьте токен в «Подключениях»';
    throw Object.assign(new Error(what), { code: 'auth' });
  }
  state = { ...state, running: true, lastError: null };
  emit();
  const out = { at: new Date().toISOString(), reason, zen: null, mail: null, errors: [] };
  if (doZen) {
    try { out.zen = await zen.sync({ full }); rebuild(); }
    catch (e) { out.errors.push({ source: 'zenmoney', code: e.code || 'error', message: e.message }); }
  }
  if (doMail) {
    try { out.mail = await require('../connectors/mail').fetchReceipts({ render: require('../tools/render') }); }
    catch (e) { out.errors.push({ source: 'mail', code: e.code || 'error', message: e.message }); }
  }
  const failedAll = out.errors.length && !out.zen && !out.mail;
  state = { running: false, lastError: out.errors[0] ? { ...out.errors[0], at: out.at } : null, lastRun: { ...out, ...(out.zen || {}) } };
  emit();
  if (!failedAll) {
    const info = { reason, changed: out.zen ? out.zen.changed : 0, deleted: out.zen ? out.zen.deleted : 0, mailReceipts: out.mail ? out.mail.receipts : 0, errors: out.errors };
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('digest:updated', info);
    if (out.zen || (out.mail && out.mail.receipts)) require('../insights/insights').maybeAuto('refresh'); // выводы ИИ — если данные изменились
  }
  if (failedAll) { const e = out.errors[0]; throw Object.assign(new Error(e.message), { code: e.code }); }
  return status();
}

function status() {
  const z = settings.get().zenmoney, m = settings.get().mail;
  const mail = require('../connectors/mail');
  return {
    running: state.running, lastError: state.lastError, lastRun: state.lastRun,
    lastSync: z.lastSync, lastSyncText: z.lastSync ? stamp(z.lastSync) : null,
    connected: zenReady(), hasData: zen.hasData(),
    mail: { connected: mailReady(), lastCheck: m.lastCheck, lastCheckText: m.lastCheck ? stamp(m.lastCheck) : null, lastResult: m.lastResult, pending: mail.pendingCount(), autoParse: !!m.autoParse },
    anySource: zenReady() || mailReady(),
  };
}

module.exports = { get, refresh, rebuild, status, onState: f => listeners.add(f), localDate };
