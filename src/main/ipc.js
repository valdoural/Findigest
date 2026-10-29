'use strict';
/**
 * Все каналы между окном и основным процессом. Окно не имеет доступа к Node.js,
 * файлам и ключам — только к этим вызовам (через preload). Каналы сгруппированы по модулям,
 * новый модуль добавляет свой блок register*().
 */
const { ipcMain, dialog, shell, BrowserWindow, session } = require('electron');
const fs = require('fs');
const settings = require('./config/settings');
const secrets = require('./config/secrets');
const store = require('./db/store');
const ai = require('./ai/router');
const zen = require('./connectors/zenmoney');
const mail = require('./connectors/mail');
const { P } = require('./paths');
const log = require('./log');

/** Ошибку отдаём в окно в виде {error:{code,message}} — Electron теряет свойства Error при передаче. */
const wrap = fn => async (_e, ...args) => {
  try { return { ok: true, value: await fn(...args) }; }
  catch (e) { return { ok: false, error: { code: e.code || 'error', message: e.message || String(e) } }; }
};
const handle = (ch, fn) => ipcMain.handle(ch, wrap(fn));

async function applyProxy() {
  const proxy = (settings.get().network.proxy || '').trim();
  await session.defaultSession.setProxy(proxy ? { proxyRules: proxy } : { mode: 'system' });
}

function registerStore() {
  handle('store:get', (col, id) => store.docGet(col, id));
  handle('store:set', (col, id, data) => store.docSet(col, id, data));
  handle('store:del', (col, id) => store.docDel(col, id));
  handle('store:list', col => store.colList(col));
}

function registerDownloads() {
  handle('dl:save', async ({ filename, text, bytes }) => {
    const win = BrowserWindow.getFocusedWindow();
    const r = await dialog.showSaveDialog(win, { defaultPath: filename });
    if (r.canceled || !r.filePath) throw Object.assign(new Error('Сохранение отменено'), { code: 'cancelled' });
    fs.writeFileSync(r.filePath, text != null ? text : Buffer.from(bytes));
    return r.filePath;
  });
}

function registerAI() {
  handle('ai:run', task => ai.run(task));
  handle('ai:abort', id => ai.abort(id));
  handle('ai:available', () => ai.available());
}

function connStatus() {
  const s = settings.get();
  const sec = secrets.status();
  return {
    ai: ai.describe(),
    aiFallback: s.ai.fallback,
    aiInsights: s.ai.insights !== false,
    aiModelLists: s.ai.modelLists || {},
    zenmoney: { enabled: s.zenmoney.enabled, hasToken: sec.items.zenmoney_token.set, tail: sec.items.zenmoney_token.tail, lastSync: s.zenmoney.lastSync },
    mail: { ...s.mail, hasPassword: sec.items.mail_password.set, presets: mail.PRESETS },
    network: s.network,
    secrets: sec,
    db: store.stats(),
    paths: { root: P.root, config: P.configDir, data: P.dataDir, archive: P.archiveDir, logs: P.logsDir },
  };
}

function registerConnections() {
  handle('conn:status', connStatus);
  handle('conn:setSecret', async (name, value) => {
    if (!secrets.KNOWN[name]) throw new Error('Неизвестный ключ');
    await secrets.set(name, value);
    return connStatus();
  });
  handle('conn:setAi', patch => {
    const cur = settings.get().ai;
    if (patch.remove) {   // убрать сервис из подключённых: выключить, забыть модель и доп. поля (ключ удаляется отдельно)
      const id = String(patch.remove), drop = o => { const c = { ...(o || {}) }; delete c[id]; return c; };
      const enabled = { ...cur.enabled, [id]: false };
      const primary = cur.primary === id ? (Object.keys(enabled).find(k => enabled[k] && k !== id) || cur.primary) : cur.primary;
      settings.patch('ai', { enabled, primary, models: drop(cur.models), extra: drop(cur.extra), modelLists: drop(cur.modelLists) });
      return connStatus();
    }
    settings.patch('ai', {
      primary: patch.primary || cur.primary,
      fallback: patch.fallback || cur.fallback,
      enabled: { ...cur.enabled, ...(patch.enabled || {}) },
      models: { ...cur.models, ...(patch.models || {}) },
      insights: typeof patch.insights === 'boolean' ? patch.insights : cur.insights,
      extra: patch.extra ? Object.fromEntries(Object.entries({ ...(cur.extra || {}), ...patch.extra }).map(([k, v]) => [k, { ...((cur.extra || {})[k] || {}), ...v }])) : (cur.extra || {}),
    });
    return connStatus();
  });
  handle('conn:setMail', patch => {
    const allowed = ['enabled', 'provider', 'host', 'port', 'user', 'folder', 'senders', 'subjectSearch', 'depthDays', 'autoParse', 'pollMinutes'];
    const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
    if (clean.pollMinutes != null) clean.pollMinutes = [0, 15, 30, 60].includes(+clean.pollMinutes) ? +clean.pollMinutes : 30;
    // новый магазин или адрес: следующая проверка заглянет на всю глубину (depthDays) — его старые чеки тоже найдутся;
    // уже обработанные письма пропускаются по таблице mail_seen, дублей не будет
    if (clean.senders) {
      const old = new Set(Object.values(settings.get().mail.senders || {}).map(a => String(a).trim().toLowerCase()));
      if (Object.values(clean.senders).some(a => a && !old.has(String(a).trim().toLowerCase()))) clean.rescan = true;
    }
    settings.patch('mail', clean);
    return connStatus();
  });
  handle('conn:setZen', patch => { settings.patch('zenmoney', { enabled: !!patch.enabled }); return connStatus(); });
  handle('conn:setLogos', on => { settings.patch('network', { logos: !!on }); return connStatus(); });
  handle('conn:setProxy', async proxy => { settings.patch('network', { proxy: String(proxy || '').trim() }); await applyProxy(); return connStatus(); });
  handle('conn:models', ({ id, refresh }) => ai.models(id, { refresh: !!refresh }));
  handle('conn:test', async kind => {
    let r;
    if (kind === 'zenmoney') r = await zen.test();
    else if (kind === 'zenmoney-sync') r = await require('./digest/service').refresh({ reason: 'connect' });
    else if (kind === 'mail') r = await mail.test();
    else r = await ai.test(kind);
    log.info('Проверка подключения', kind, 'ok');
    return r;
  });
}

function registerApp(hooks) {
  handle('app:open', which => {
    const map = { config: P.configDir, data: P.dataDir, archive: P.archiveDir, logs: P.logsDir, root: P.root };
    const target = map[which];
    if (!target) throw new Error('Нет такой папки');
    return shell.openPath(target);
  });
  handle('app:openUrl', url => {
    if (!/^https:\/\//.test(url)) throw new Error('Только https-ссылки');
    return shell.openExternal(url);
  });
  handle('app:reload', () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.reload(); });
  handle('app:firstRunDone', () => { settings.patch('firstRunDone', true); hooks.onFirstRunDone && hooks.onFirstRunDone(); });
  handle('app:info', () => ({ version: require('../../package.json').version, firstRunDone: settings.get().firstRunDone, skin: settings.get().app.skin || '' }));
}

function registerDigest(hooks) {
  const service = require('./digest/service');
  const scheduler = require('./scheduler');
  handle('digest:data', () => service.get());
  handle('digest:refresh', opts => service.refresh({ full: !!(opts && opts.full), reason: 'manual', only: opts && opts.only, retry: !!(opts && opts.retry) }));
  handle('digest:status', () => ({ ...service.status(), schedule: scheduler.describe(), app: settings.get().app }));
  handle('schedule:set', patch => {
    const cur = settings.get().schedule;
    const mode = ['off', 'times', 'interval'].includes(patch.mode) ? patch.mode : cur.mode;
    const times = Array.isArray(patch.times) ? patch.times.map(String).filter(t => /^\d{1,2}:\d{2}$/.test(t.trim())).map(t => t.trim().padStart(5, '0')) : cur.times;
    const everyHours = patch.everyHours != null ? Math.min(24, Math.max(1, +patch.everyHours || 3)) : cur.everyHours;
    const onStart = patch.onStart != null ? !!patch.onStart : cur.onStart;
    settings.patch('schedule', { mode, times, everyHours, onStart });
    return scheduler.describe();
  });
  handle('app:setPrefs', patch => {
    const cur = settings.get().app;
    const SKINS = ['', 'frost', 'malachite', 'midnight'];
    settings.patch('app', { tray: patch.tray != null ? !!patch.tray : cur.tray, autostart: patch.autostart != null ? !!patch.autostart : cur.autostart,
      skin: patch.skin != null && SKINS.includes(patch.skin) ? patch.skin : (cur.skin || '') });
    if (hooks.applyAutostart) hooks.applyAutostart();
    return settings.get().app;
  });
}

function registerAssistant(hooks) {
  handle('logos:get', items => require('./logos').get(items));
  const updates = require('./updates');
  handle('updates:status', () => updates.status());
  handle('updates:check', () => updates.check());
  handle('updates:set', patch => updates.set(patch || {}));
  handle('updates:install', version => updates.install(version || null));
  const insights = require('./insights/insights');
  handle('insights:get', () => insights.status());
  const region = require('./insights/region');
  handle('region:get', () => region.state());
  handle('region:set', name => region.setRegion(String(name)));
  handle('region:refresh', () => region.refresh({ auto: false }));
  handle('insights:refresh', () => insights.generate({ force: true, reason: 'manual' }));
  handle('insights:setAuto', on => { settings.patch('ai', { insights: !!on }); if (on) insights.maybeAuto('enabled'); return insights.status(); });
  const assistant = require('./assistant/assistant');
  handle('assistant:ask', q => assistant.ask(q));
  handle('assistant:transcribe', ({ audio, reqId }) => ai.transcribe(audio, reqId));
  handle('assistant:speak', text => ai.speak(text));
  handle('assistant:speechText', text => require('./ai/speech').prepare(String(text || '')));   // для голоса Windows: числа словами
  handle('assistant:history', () => assistant.history());
  handle('assistant:clear', () => assistant.clearHistory());
  handle('assistant:info', () => ({ ai: ai.available(), ...ai.speechInfo(), settings: settings.get().assistant }));
  handle('assistant:set', patch => {
    const allowed = ['stt', 'tts', 'voice', 'openaiVoice', 'speak', 'autoStop', 'hotkey', 'globalHotkey'];
    const p = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
    if (patch && patch.voices && typeof patch.voices === 'object') p.voices = { ...(settings.get().assistant.voices || {}), ...patch.voices };
    settings.patch('assistant', p);
    if (hooks.applyHotkey) hooks.applyHotkey();
    return { ai: ai.available(), ...ai.speechInfo(), settings: settings.get().assistant };
  });
}

function register(hooks = {}) {
  registerAssistant(hooks);
  registerDigest(hooks);
  registerStore();
  registerDownloads();
  registerAI();
  registerConnections();
  registerApp(hooks);
}

module.exports = { register, applyProxy };
