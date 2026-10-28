'use strict';
/**
 * Zenmoney API (v8 diff). Токен — в secrets.json (zenmoney_token).
 *
 * sync():  первая синхронизация забирает всё (serverTimestamp = 0), следующие — только изменения
 *          с прошлого раза; удалённые в Zenmoney операции удаляются и здесь. Данные кладутся в zm_* таблицы.
 * load():  читает zm_* в нормализованный вид для digest/build.js.
 * Только чтение: в Zenmoney приложение ничего не записывает.
 */
const { net } = require('electron');
const secrets = require('../config/secrets');
const settings = require('../config/settings');
const D = require('../db/database');
const log = require('../log');

const DIFF = 'https://api.zenmoney.ru/v8/diff/';

async function diff(body) {
  const token = secrets.get('zenmoney_token');
  if (!token) throw Object.assign(new Error('Токен Zenmoney не задан'), { code: 'auth' });
  const res = await net.fetch(DIFF, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ currentClientTimestamp: Math.floor(Date.now() / 1000), serverTimestamp: 0, ...body }),
  });
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error('Токен не принят Zenmoney — получите новый'), { code: 'auth' });
  if (!res.ok) throw Object.assign(new Error(`Zenmoney ответил ${res.status}: ${text.slice(0, 200)}`), { code: 'server' });
  return JSON.parse(text);
}

/** Проверка: запрашиваем только профиль — быстро и без выгрузки операций. */
async function test() {
  const now = Math.floor(Date.now() / 1000);
  const r = await diff({ serverTimestamp: now, forceFetch: ['user', 'instrument'] });
  const u = (r.user || [])[0] || {};
  return { ok: true, login: u.login || '', serverTimestamp: r.serverTimestamp };
}

/* ---------- запись ответа diff в базу ---------- */
const b = v => (v ? 1 : 0);
function txRow(t) {
  const inc = +t.income || 0, out = +t.outcome || 0;
  let inAcc = null, inAmt = 0, outAcc = null, outAmt = 0;
  if (inc > 0 && out > 0 && t.incomeAccount !== t.outcomeAccount) { inAcc = t.incomeAccount; inAmt = inc; outAcc = t.outcomeAccount; outAmt = out; }
  else if (out > 0) { outAcc = t.outcomeAccount; outAmt = out; }
  else if (inc > 0) { inAcc = t.incomeAccount; inAmt = inc; }
  else return null; // нулевая операция
  const tags = Array.isArray(t.tag) ? t.tag : [];
  return [t.id, t.date, inAcc, inAmt, outAcc, outAmt, tags[0] || null, JSON.stringify(tags), t.merchant || null,
    t.originalPayee || t.payee || '', t.comment || '', b(t.hold), t.changed || 0];
}

function apply(r) {
  const db = D.db;
  const n = { tx: 0, del: 0 };
  D.tx(() => {
    const ins = db.prepare('INSERT OR REPLACE INTO zm_instruments(id,code,rate) VALUES(?,?,?)');
    for (const x of r.instrument || []) ins.run(x.id, x.shortTitle, x.rate);
    const comp = db.prepare('INSERT OR REPLACE INTO zm_companies(id,title,www) VALUES(?,?,?)');
    for (const x of r.company || []) comp.run(x.id, x.title || x.fullTitle || '', x.www || null);
    const acc = db.prepare(`INSERT OR REPLACE INTO zm_accounts(id,title,type,instrument,company,balance,start_balance,credit_limit,in_balance,savings,archive,changed)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const x of r.account || []) acc.run(x.id, x.title, x.type, x.instrument, x.company || null, +x.balance || 0, +x.startBalance || 0, +x.creditLimit || 0, b(x.inBalance), b(x.savings), b(x.archive), x.changed || 0);
    const tag = db.prepare('INSERT OR REPLACE INTO zm_tags(id,title,parent,show_income,show_outcome,changed) VALUES(?,?,?,?,?,?)');
    for (const x of r.tag || []) tag.run(x.id, x.title, x.parent || null, b(x.showIncome), b(x.showOutcome), x.changed || 0);
    const mer = db.prepare('INSERT OR REPLACE INTO zm_merchants(id,title,changed) VALUES(?,?,?)');
    for (const x of r.merchant || []) mer.run(x.id, x.title, x.changed || 0);
    const tx = db.prepare(`INSERT OR REPLACE INTO zm_tx(id,date,in_acc,in_amt,out_acc,out_amt,cat,tags,merchant,payee,comment,hold,changed)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const del = db.prepare('DELETE FROM zm_tx WHERE id=?');
    for (const t of r.transaction || []) {
      const row = t.deleted ? null : txRow(t);
      if (row) { tx.run(...row); n.tx++; } else { del.run(t.id); n.del++; }
    }
    const kill = { transaction: 'zm_tx', account: 'zm_accounts', tag: 'zm_tags', merchant: 'zm_merchants' };
    for (const d of r.deletion || []) if (kill[d.object]) { db.prepare(`DELETE FROM ${kill[d.object]} WHERE id=?`).run(d.id); n.del++; }
    db.prepare("INSERT INTO meta(key,value) VALUES('zm_server_ts',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(r.serverTimestamp || 0));
    const u = (r.user || [])[0];
    if (u) db.prepare("INSERT INTO meta(key,value) VALUES('zm_user_currency',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(u.currency));
  });
  return n;
}

let running = null;
/** Синхронизация. full=true — заново со всей историей. */
function sync({ full = false } = {}) {
  if (running) return running;
  running = (async () => {
    const started = new Date().toISOString();
    const row = D.db.prepare("SELECT value FROM meta WHERE key='zm_server_ts'").get();
    const since = full || !row ? 0 : +row.value || 0;
    try {
      const r = await diff({ serverTimestamp: since });
      const n = apply(r);
      settings.patch('zenmoney', { lastSync: new Date().toISOString(), serverTimestamp: r.serverTimestamp });
      const total = D.db.prepare('SELECT COUNT(*) n FROM zm_tx').get().n;
      D.db.prepare('INSERT INTO sync_log(source,started,finished,status,message) VALUES(?,?,?,?,?)')
        .run('zenmoney', started, new Date().toISOString(), 'ok', `${since ? 'изменения' : 'полная'}: +${n.tx} / −${n.del}, всего операций ${total}`);
      log.info(`Zenmoney: ${since ? 'изменения' : 'полная загрузка'}, операций обновлено ${n.tx}, удалено ${n.del}, всего ${total}`);
      return { full: !since, changed: n.tx, deleted: n.del, total };
    } catch (e) {
      D.db.prepare('INSERT INTO sync_log(source,started,finished,status,message) VALUES(?,?,?,?,?)')
        .run('zenmoney', started, new Date().toISOString(), 'error', e.message);
      throw e;
    } finally { running = null; }
  })();
  return running;
}

/** Данные из базы в нормализованном виде для расчёта отчёта. */
function load(today) {
  const db = D.db;
  const inst = Object.fromEntries(db.prepare('SELECT id,code,rate FROM zm_instruments').all().map(x => [x.id, x]));
  const cur = +((db.prepare("SELECT value FROM meta WHERE key='zm_user_currency'").get() || {}).value || 2);
  const base = (inst[cur] || { rate: 1 }).rate || 1;
  const rates = {};
  for (const x of Object.values(inst)) rates[x.code] = (x.rate || 1) / base;
  const companies = Object.fromEntries(db.prepare('SELECT id,title,www FROM zm_companies').all().map(x => [x.id, x]));
  const comp = Object.fromEntries(Object.values(companies).map(x => [x.id, x.title]));
  const accounts = db.prepare('SELECT * FROM zm_accounts').all().map(a => ({
    id: a.id, name: a.title, type: a.type, instrument: (inst[a.instrument] || {}).code || 'RUB',
    balance: a.balance, startBalance: a.start_balance, inBalance: !!a.in_balance, savings: !!a.savings,
    archived: !!a.archive, bank: comp[a.company] || '', bankWww: (companies[a.company] || {}).www || '',
  }));
  const categories = Object.fromEntries(db.prepare('SELECT id,title,show_income,show_outcome FROM zm_tags').all()
    .map(t => [t.id, { name: t.title, isIncome: !!t.show_income, isExpense: !!t.show_outcome }]));
  const merchants = Object.fromEntries(db.prepare('SELECT id,title FROM zm_merchants').all().map(m => [m.id, m.title]));
  const tx = db.prepare('SELECT * FROM zm_tx ORDER BY date').all().map(t => ({
    id: t.id, date: t.date, inAcc: t.in_acc, inAmt: t.in_amt, outAcc: t.out_acc, outAmt: t.out_amt,
    cat: t.cat, merchant: t.merchant, payee: t.payee, comment: t.comment,
  }));
  return { accounts, categories, merchants, rates, tx, today };
}

const hasData = () => { try { return D.db.prepare('SELECT COUNT(*) n FROM zm_tx').get().n > 0; } catch (_) { return false; } };

module.exports = { test, diff, sync, load, hasData, apply, txRow };
