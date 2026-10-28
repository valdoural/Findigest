'use strict';
/**
 * Мост между окном и основным процессом. В окно попадает только объект window.fdNative
 * со списком разрешённых вызовов — ни Node.js, ни файловой системы, ни ключей.
 */
const { contextBridge, ipcRenderer } = require('electron');

async function call(ch, ...args) {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (r && r.ok) return r.value;
  const e = new Error((r && r.error && r.error.message) || 'Ошибка');
  e.code = (r && r.error && r.error.code) || 'error';
  if (e.code === 'aborted') e.name = 'AbortError';
  throw e;
}

contextBridge.exposeInMainWorld('fdNative', {
  store: {
    get: (col, id) => call('store:get', col, id),
    set: (col, id, data) => call('store:set', col, id, data),
    del: (col, id) => call('store:del', col, id),
    list: col => call('store:list', col),
  },
  downloads: { save: payload => call('dl:save', payload) },
  ai: {
    run: task => call('ai:run', task),
    abort: id => call('ai:abort', id),
    available: () => call('ai:available'),
  },
  conn: {
    status: () => call('conn:status'),
    setSecret: (name, value) => call('conn:setSecret', name, value),
    setAi: patch => call('conn:setAi', patch),
    setMail: patch => call('conn:setMail', patch),
    setZen: patch => call('conn:setZen', patch),
    setProxy: proxy => call('conn:setProxy', proxy),
    setLogos: on => call('conn:setLogos', on),
    test: kind => call('conn:test', kind),
    models: (id, refresh) => call('conn:models', { id, refresh }),
  },
  digest: {
    data: () => call('digest:data'),
    refresh: opts => call('digest:refresh', opts),
    status: () => call('digest:status'),
    setSchedule: patch => call('schedule:set', patch),
    setPrefs: patch => call('app:setPrefs', patch),
    onState: cb => { const h = (_e, s) => cb(s); ipcRenderer.on('digest:state', h); return () => ipcRenderer.removeListener('digest:state', h); },
    onUpdated: cb => { const h = (_e, s) => cb(s); ipcRenderer.on('digest:updated', h); return () => ipcRenderer.removeListener('digest:updated', h); },
  },
  logos: { get: items => call('logos:get', items) },
  updates: {
    status: () => call('updates:status'),
    check: () => call('updates:check'),
    set: patch => call('updates:set', patch),
    install: version => call('updates:install', version),
    onAvailable: cb => { const h = (_e, s) => cb(s); ipcRenderer.on('updates:available', h); return () => ipcRenderer.removeListener('updates:available', h); },
    onProgress: cb => { const h = (_e, s) => cb(s); ipcRenderer.on('updates:progress', h); return () => ipcRenderer.removeListener('updates:progress', h); },
  },
  region: {
    get: () => call('region:get'),
    set: name => call('region:set', name),
    refresh: () => call('region:refresh'),
    onUpdated: cb => { const h = (_e, s) => cb(s); ipcRenderer.on('region:updated', h); return () => ipcRenderer.removeListener('region:updated', h); },
  },
  insights: {
    get: () => call('insights:get'),
    refresh: () => call('insights:refresh'),
    setAuto: on => call('insights:setAuto', on),
    onUpdated: cb => { const h = (_e, s) => cb(s); ipcRenderer.on('insights:updated', h); return () => ipcRenderer.removeListener('insights:updated', h); },
    onState: cb => { const h = (_e, s) => cb(s); ipcRenderer.on('insights:state', h); return () => ipcRenderer.removeListener('insights:state', h); },
  },
  assistant: {
    ask: q => call('assistant:ask', q),
    transcribe: (audio, reqId) => call('assistant:transcribe', { audio, reqId }),
    speak: text => call('assistant:speak', text),
    history: () => call('assistant:history'),
    clear: () => call('assistant:clear'),
    info: () => call('assistant:info'),
    set: patch => call('assistant:set', patch),
    abort: id => call('ai:abort', id),
    onListen: cb => { const h = () => cb(); ipcRenderer.on('assistant:listen', h); return () => ipcRenderer.removeListener('assistant:listen', h); },
  },
  app: {
    open: which => call('app:open', which),
    openUrl: url => call('app:openUrl', url),
    reload: () => call('app:reload'),
    firstRunDone: () => call('app:firstRunDone'),
    info: () => call('app:info'),
  },
});
