'use strict';
/**
 * Единая точка вызова ИИ. Интерфейс отчёта (и в будущем голосовой помощник, фоновые задачи)
 * не знает, какой провайдер отвечает: роутер берёт основной из настроек и при сбое
 * переходит к резервным. Новый провайдер = новый файл в providers/ + строка в PROVIDERS.
 */
const settings = require('../config/settings');
const secrets = require('../config/secrets');
const log = require('../log');
const { parseJson, AIError } = require('./http');

const compat = require('./providers/compat');
const PROVIDERS = {
  anthropic: require('./providers/anthropic'),
  openai: require('./providers/openai'),
  gemini: require('./providers/gemini'),
  ...compat.PROVIDERS, // DeepSeek, Mistral, Grok, OpenRouter, Groq, Perplexity, Together, Cohere, Qwen, Kimi, GLM, YandexGPT, GigaChat, Ollama, LM Studio, свой сервер
};
const LOGO = { anthropic: ['#D97757', 'C'], openai: ['#10A37F', 'G'], gemini: ['#4285F4', 'G'] };
for (const id of ['anthropic', 'openai', 'gemini']) Object.assign(PROVIDERS[id], { group: 'world', logo: LOGO[id], fields: [] });
// ключи новых сервисов — в том же зашифрованном secrets.json
for (const p of Object.values(PROVIDERS)) if (p.keyName && !secrets.KNOWN[p.keyName]) secrets.KNOWN[p.keyName] = `${p.title} (${p.vendor}) — ${p.keyLabel || 'ключ API'}`;
const extraOf = id => ((settings.get().ai.extra || {})[id]) || {};
const keyOf = p => (p.keyName ? secrets.get(p.keyName) : '');

// Тестовый провайдер (только для автотестов): FD_AI_MOCK=путь к модулю
if (process.env.FD_AI_MOCK) PROVIDERS.mock = require(process.env.FD_AI_MOCK);

const running = new Map(); // id запроса → AbortController

function ready(id) {
  if (id === 'mock') return !!PROVIDERS.mock;
  const p = PROVIDERS[id];
  const s = settings.get().ai;
  if (!p || !s.enabled[id] || !(s.models[id] || p.defaultModel)) return false;
  if (!p.noKey && !p.optionalKey && !keyOf(p)) return false;
  const ex = extraOf(id);
  return (p.fields || []).every(f => !f.required || String(ex[f.name] || '').trim());
}

function order() {
  const s = settings.get().ai;
  const list = PROVIDERS.mock ? ['mock'] : [s.primary, ...(s.fallback || []), ...Object.keys(PROVIDERS)];
  return [...new Set(list)].filter(ready);
}

function available() { return order().length > 0; }

/** Задача для ИИ: { prompt, system?, images?:[{mime,base64}], json?:bool, reqId? } */
async function run(task) {
  // task.prefer — сервисы, которые лучше подходят задаче (например, с поиском в интернете), если они подключены
  const chain = [...new Set([...(task.prefer || []).filter(id => PROVIDERS[id] && ready(id)), ...order()])];
  if (!chain.length) throw new AIError('not_granted', 'ИИ не подключён: добавьте ключ Claude, Gemini или GPT в «Подключениях»');
  const ac = new AbortController();
  if (task.reqId) running.set(task.reqId, ac);
  const s = settings.get().ai;
  let lastErr = null;
  try {
    const call = async id => {
      const p = PROVIDERS[id];
      const t0 = Date.now();
      const text = await p.complete({
        key: keyOf(p), model: s.models[id] || p.defaultModel, opts: extraOf(id),
        system: task.system, prompt: task.prompt, images: task.images || [], json: !!task.json, signal: ac.signal,
      });
      log.info(`ИИ ${id}: ответ за ${Date.now() - t0} мс`);
      return { provider: id, result: task.json ? parseJson(text) : text };
    };
    let waitFor = null; // лимит «в минуту»: если других ИИ нет — подождать и повторить один раз
    for (const id of chain) {
      try { return await call(id); } catch (e) {
        lastErr = e;
        log.warn(`ИИ ${id}: ${e.code || ''} ${e.message}`);
        // остановку пользователем не перекладываем на другого провайдера
        if (e.code === 'aborted' || ac.signal.aborted) throw new AIError('aborted', 'Остановлено');
        if (e.retryAfterMs && e.retryAfterMs <= 60000 && !waitFor) waitFor = { id, ms: e.retryAfterMs };
      }
    }
    if (waitFor && task.retry !== false) {
      log.info(`ИИ ${waitFor.id}: повтор через ${Math.round(waitFor.ms / 1000)} с`);
      if (task.onWait) task.onWait(waitFor.ms);
      await new Promise((res, rej) => {
        const t = setTimeout(res, waitFor.ms + 500);
        ac.signal.addEventListener('abort', () => { clearTimeout(t); rej(new AIError('aborted', 'Остановлено')); }, { once: true });
      });
      try { return await call(waitFor.id); } catch (e) { lastErr = e; }
    }
    throw lastErr;
  } finally {
    if (task.reqId) running.delete(task.reqId);
  }
}

/* ---------- речь ---------- */
const speechReady = id => ready(id) && typeof PROVIDERS[id].transcribe === 'function';
/** Кто расшифрует голос: из настроек помощника или первый подходящий (Gemini, затем GPT). */
function sttProvider() {
  const pref = (settings.get().assistant || {}).stt || 'auto';
  if (pref !== 'auto') return speechReady(pref) ? pref : null;
  return ['mock', 'gemini', 'openai', 'groq'].find(speechReady) || null;
}
async function transcribe(audio, reqId) {
  const id = sttProvider();
  if (!id) throw new AIError('no_stt', 'Для голоса нужен ключ Gemini или GPT: Claude не умеет распознавать речь. Можно задавать вопросы текстом.');
  const p = PROVIDERS[id], s = settings.get().ai;
  const ac = new AbortController(); if (reqId) running.set(reqId, ac);
  try {
    const t0 = Date.now();
    const text = await p.transcribe({ key: keyOf(p), model: s.models[id] || p.defaultModel, audio, signal: ac.signal });
    log.info(`Речь → текст (${id}): ${Date.now() - t0} мс`);
    return { provider: id, text };
  } finally { if (reqId) running.delete(reqId); }
}
/** Живой голос — ai/speech.js (OpenAI, Gemini, Yandex SpeechKit); в автотестах — тестовый провайдер. */
async function speak(text) {
  if (PROVIDERS.mock && PROVIDERS.mock.speak) return PROVIDERS.mock.speak({ text });
  return require('./speech').speak(text);
}
function speechInfo() {
  const sp = require('./speech').info();
  return { stt: sttProvider(), tts: !!sp.auto || !!(PROVIDERS.mock && PROVIDERS.mock.speak), speech: sp };
}

function abort(reqId) { const ac = running.get(reqId); if (ac) ac.abort(); }

/* ---------- списки моделей: из API провайдера, кеш в настройках на сутки ---------- */
const LIST_TTL = 864e5;
/** Модель по умолчанию: Sonnet у Claude, стабильная Flash у Gemini, свежая gpt-* (не mini/nano) у GPT — иначе первая текстовая. */
function pickDefault(id, list) {
  const chat = list.filter(m => m.chat !== false);
  const p = PROVIDERS[id] || {};
  const pref = { anthropic: m => /sonnet/.test(m.id), gemini: m => /flash/.test(m.id) && !/lite|preview|exp/.test(m.id), openai: m => /^gpt-[\d.]+(-mini)?$/.test(m.id) }[id] || (p.prefer ? m => p.prefer.test(m.id) : null);
  return ((pref && chat.find(pref)) || chat[0] || list[0] || {}).id || '';
}
async function models(id, { refresh = false } = {}) {
  const p = PROVIDERS[id];
  if (!p) throw new AIError('error', 'Неизвестный сервис ИИ');
  const key = keyOf(p);
  if (!key && !p.noKey && !p.optionalKey) throw new AIError('auth', 'Ключ не задан');
  const s = settings.get().ai, cached = (s.modelLists || {})[id];
  if (!refresh && cached && cached.list && cached.list.length && Date.now() - new Date(cached.at).getTime() < LIST_TTL) return cached;
  const list = await p.listModels(key, extraOf(id));
  const entry = { at: new Date().toISOString(), list };
  const patch = { modelLists: { ...(s.modelLists || {}), [id]: entry } };
  // выбранной модели нет в API (или не выбрана) — подставляем разумную
  if (list.length && (!s.models[id] || !list.some(m => m.id === s.models[id]))) patch.models = { ...s.models, [id]: pickDefault(id, list) };
  settings.patch('ai', patch);
  log.info(`Модели ${id}: ${list.length} (текстовых ${list.filter(m => m.chat !== false).length})`);
  return entry;
}

async function test(id) {
  const r = await models(id, { refresh: true });
  return { ok: true, models: r.list, at: r.at };
}

function describe() {
  const s = settings.get().ai;
  return Object.values(PROVIDERS).filter(p => p.id !== 'mock').map(p => ({
    id: p.id, title: p.title, vendor: p.vendor, keyUrl: p.keyUrl, keyName: p.keyName, keyLabel: p.keyLabel || 'Ключ API',
    group: p.group || 'world', logo: p.logo || ['#5F6C86', p.title[0]], noKey: !!p.noKey, optionalKey: !!p.optionalKey,
    fields: (p.fields || []).map(f => ({ ...f, value: extraOf(p.id)[f.name] || '' })), stt: typeof p.transcribe === 'function',
    enabled: !!s.enabled[p.id], model: s.models[p.id] || p.defaultModel || '',
    hasKey: p.noKey || !!keyOf(p), ready: ready(p.id), primary: s.primary === p.id,
  }));
}

module.exports = { ready, run, abort, test, models, pickDefault, describe, available, transcribe, speak, speechInfo, PROVIDERS };
