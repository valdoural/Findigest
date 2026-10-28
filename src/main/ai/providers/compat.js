'use strict';
/**
 * ИИ-сервисы с OpenAI-совместимым API (Chat Completions): один код — разные адреса, ключи и особенности.
 * Каждый элемент CATALOG становится провайдером роутера наравне с Claude/GPT/Gemini.
 *   base     — адрес API (для локальных и «своего сервера» — меняется в настройках: ai.extra[id].baseUrl);
 *   models   — путь списка моделей (null — у сервиса его нет, тогда предлагаются известные модели из static);
 *   noKey    — ключ не нужен (локальные Ollama/LM Studio);
 *   fields   — дополнительные настройки (каталог Yandex Cloud, адрес сервера);
 *   token    — особая выдача токена (GigaChat: OAuth по ключу авторизации, токен живёт 30 минут).
 * JSON-режим не включается флагом (не все сервисы его знают): модель просят ответить JSON, ответ разбирает parseJson.
 */
const crypto = require('crypto');
const { request, multipart, AIError } = require('../http');

const CATALOG = [
  // мировые
  { id: 'deepseek', title: 'DeepSeek', vendor: 'DeepSeek', base: 'https://api.deepseek.com', models: '/models', keyUrl: 'https://platform.deepseek.com/api_keys', prefer: /deepseek-chat/, logo: ['#4D6BFE', 'DS'] },
  { id: 'mistral', title: 'Mistral', vendor: 'Mistral AI', base: 'https://api.mistral.ai/v1', models: '/models', keyUrl: 'https://console.mistral.ai/api-keys', prefer: /mistral-(large|medium)-latest/, logo: ['#FA520F', 'M'] },
  { id: 'xai', title: 'Grok', vendor: 'xAI', base: 'https://api.x.ai/v1', models: '/models', keyUrl: 'https://console.x.ai', prefer: /^grok-\d/, logo: ['#111111', 'X'] },
  { id: 'openrouter', title: 'OpenRouter', vendor: 'сотни моделей по одному ключу', base: 'https://openrouter.ai/api/v1', models: '/models', keyUrl: 'https://openrouter.ai/keys', prefer: /^(anthropic\/claude-sonnet|google\/gemini-2\.5-flash|openai\/gpt-4\.1-mini)/, logo: ['#6467F2', 'OR'] },
  { id: 'groq', title: 'Groq', vendor: 'быстрые открытые модели', base: 'https://api.groq.com/openai/v1', models: '/models', keyUrl: 'https://console.groq.com/keys', prefer: /llama-3\.3-70b|gpt-oss-120b/, stt: 'whisper-large-v3', logo: ['#F55036', 'G'] },
  { id: 'perplexity', title: 'Perplexity', vendor: 'ответы с поиском в интернете', base: 'https://api.perplexity.ai', models: null, static: ['sonar', 'sonar-pro', 'sonar-reasoning-pro', 'sonar-deep-research'], keyUrl: 'https://www.perplexity.ai/account/api/keys', prefer: /^sonar$/, logo: ['#1F7A85', 'P'] },
  { id: 'together', title: 'Together AI', vendor: 'открытые модели', base: 'https://api.together.xyz/v1', models: '/models', keyUrl: 'https://api.together.ai/settings/api-keys', prefer: /Llama-3\.3-70B-Instruct-Turbo/, logo: ['#0F6FFF', 'T'] },
  { id: 'cohere', title: 'Cohere', vendor: 'Command', base: 'https://api.cohere.ai/compatibility/v1', models: 'https://api.cohere.com/v1/models?endpoint=chat&page_size=1000', keyUrl: 'https://dashboard.cohere.com/api-keys', prefer: /^command-a/, logo: ['#39594D', 'C'] },
  { id: 'qwen', title: 'Qwen', vendor: 'Alibaba Cloud', base: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', models: '/models', keyUrl: 'https://modelstudio.console.alibabacloud.com/?tab=playground#/api-key', prefer: /^qwen-(plus|max)$/, logo: ['#615CED', 'Q'] },
  { id: 'moonshot', title: 'Kimi', vendor: 'Moonshot AI', base: 'https://api.moonshot.ai/v1', models: '/models', keyUrl: 'https://platform.moonshot.ai/console/api-keys', prefer: /kimi-k2/, logo: ['#16191E', 'K'] },
  { id: 'zai', title: 'GLM', vendor: 'Z.ai (Zhipu)', base: 'https://api.z.ai/api/paas/v4', models: '/models', static: ['glm-4.6', 'glm-4.5', 'glm-4.5-air', 'glm-4.5-flash'], keyUrl: 'https://z.ai/manage-apikey/apikey-list', prefer: /^glm-4\.6$/, logo: ['#2D63F6', 'Z'] },
  // российские
  { id: 'yandex', title: 'YandexGPT', vendor: 'Yandex Cloud AI Studio', base: 'https://llm.api.cloud.yandex.net/v1', models: '/models', static: ['yandexgpt/latest', 'yandexgpt/rc', 'yandexgpt-lite/latest'], keyUrl: 'https://yandex.cloud/ru/docs/iam/operations/api-key/create',
    fields: [{ name: 'folder', label: 'ID каталога Yandex Cloud', placeholder: 'b1g…', required: true, hint: 'Консоль Yandex Cloud → каталог → ID над списком сервисов' }], prefer: /yandexgpt\/latest/, ru: true, logo: ['#FC3F1D', 'Я'] },
  { id: 'gigachat', title: 'GigaChat', vendor: 'Сбер', base: 'https://api.giga.chat/v1', models: '/models', static: ['GigaChat', 'GigaChat-Pro', 'GigaChat-Max'], keyUrl: 'https://developers.sber.ru/studio/workspaces', keyLabel: 'Ключ авторизации',
    fields: [{ name: 'scope', label: 'Тип доступа', options: [['GIGACHAT_API_PERS', 'физлицо'], ['GIGACHAT_API_B2B', 'ИП/юрлицо, пакеты'], ['GIGACHAT_API_CORP', 'ИП/юрлицо, оплата по факту']] }], token: 'gigachat', prefer: /^GigaChat(-2)?-?Pro$|^GigaChat$/, ru: true, logo: ['#21A038', 'GC'] },
  // локальные и свои
  { id: 'ollama', title: 'Ollama', vendor: 'на этом компьютере, без интернета', base: 'http://127.0.0.1:11434/v1', models: '/models', noKey: true, keyUrl: 'https://ollama.com/download',
    fields: [{ name: 'baseUrl', label: 'Адрес сервера', placeholder: 'http://127.0.0.1:11434/v1' }], local: true, logo: ['#000000', 'Ol'] },
  { id: 'lmstudio', title: 'LM Studio', vendor: 'на этом компьютере, без интернета', base: 'http://127.0.0.1:1234/v1', models: '/models', noKey: true, keyUrl: 'https://lmstudio.ai',
    fields: [{ name: 'baseUrl', label: 'Адрес сервера', placeholder: 'http://127.0.0.1:1234/v1' }], local: true, logo: ['#4B3FCE', 'LM'] },
  { id: 'custom', title: 'Свой сервер', vendor: 'любой OpenAI-совместимый API', base: '', models: '/models', optionalKey: true, keyUrl: '',
    fields: [{ name: 'baseUrl', label: 'Адрес API (…/v1)', placeholder: 'https://my-llm.example.com/v1', required: true }], local: true, logo: ['#5F6C86', '⋯'] },
];

const NOT_CHAT = /(embed|embedding|whisper|tts|speech|audio|transcri|rerank|moderation|guard|image|vision-?only|dall|flux|stable-?diffusion|sdxl|ocr|bge|e5-|clip)/i;

/* ---------- GigaChat: токен доступа по ключу авторизации, кеш до истечения ---------- */
const tokens = new Map();
async function gigachatToken(key, scope, signal) {
  const c = tokens.get(key);
  if (c && c.until - Date.now() > 60000) return c.token;
  const r = await request('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
    method: 'POST', signal, timeoutMs: 20000,
    headers: { authorization: 'Basic ' + key, RqUID: crypto.randomUUID(), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    rawBody: Buffer.from('scope=' + encodeURIComponent(scope || 'GIGACHAT_API_PERS')),
  });
  if (!r || !r.access_token) throw new AIError('auth', 'GigaChat не выдал токен доступа — проверьте ключ авторизации и тип доступа');
  const exp = +r.expires_at || 0;
  tokens.set(key, { token: r.access_token, until: exp > 1e12 ? exp : exp ? exp * 1000 : Date.now() + 25 * 60000 });
  return r.access_token;
}

function make(cfg) {
  const baseOf = opts => String((opts && opts.baseUrl) || cfg.base || '').trim().replace(/\/+$/, '');
  const headers = async (key, opts, signal) => {
    const h = {};
    if (cfg.token === 'gigachat') h.authorization = 'Bearer ' + await gigachatToken(key, opts && opts.scope, signal);
    else if (key) h.authorization = 'Bearer ' + key;
    if (cfg.id === 'yandex' && opts && opts.folder) h['OpenAI-Project'] = opts.folder;
    if (cfg.id === 'openrouter') { h['HTTP-Referer'] = 'https://findigest.local'; h['X-Title'] = 'Finansovyi Daidzhest'; }
    return h;
  };
  // у YandexGPT модель — URI с каталогом: gpt://<каталог>/yandexgpt/latest
  const modelId = (model, opts) => (cfg.id === 'yandex' && model && !/^gpt:\/\//.test(model) && opts && opts.folder ? `gpt://${opts.folder}/${model}` : model);
  const p = {
    id: cfg.id, title: cfg.title, vendor: cfg.vendor, keyName: cfg.noKey ? null : cfg.id + '_api_key', keyUrl: cfg.keyUrl, keyLabel: cfg.keyLabel || 'Ключ API',
    defaultModel: '', noKey: !!cfg.noKey, optionalKey: !!cfg.optionalKey, fields: cfg.fields || [], group: cfg.local ? 'local' : cfg.ru ? 'ru' : 'world', logo: cfg.logo, prefer: cfg.prefer,

    async listModels(key, opts = {}) {
      const base = baseOf(opts);
      if (!base) throw new AIError('error', 'Укажите адрес API в настройках сервиса');
      const fallback = () => (cfg.static || []).map(id => ({ id, name: id, chat: true, known: true }));
      if (!cfg.models) return fallback();
      let r;
      try {
        const url = /^https?:/.test(cfg.models) ? cfg.models : base + cfg.models;
        r = await request(url, { headers: await headers(key, opts), timeoutMs: 20000 });
      } catch (e) {
        if (cfg.static && (e.code === 'model' || e.status === 404 || e.status === 405)) return fallback(); // у сервиса нет списка моделей
        throw e;
      }
      const arr = Array.isArray(r) ? r : (r && (r.data || r.models)) || [];
      const list = arr.map(m => {
        const id = String(m.id || m.name || '').replace(/^models\//, '');
        const type = String(m.type || m.object_type || '');
        const out = m.architecture && m.architecture.output_modalities;
        const chat = !NOT_CHAT.test(id) && (!type || /chat|language|text|model/.test(type)) && (!out || out.includes('text'));
        const name = m.display_name || (m.name && m.name !== id ? m.name : id);
        return { id: cfg.id === 'yandex' ? id.replace(/^gpt:\/\/[^/]+\//, '') : id, name: cfg.id === 'yandex' ? name.replace(/^gpt:\/\/[^/]+\//, '') : name, chat };
      }).filter(m => m.id);
      if (!list.length) return fallback();
      return list.sort((a, b) => (b.chat - a.chat) || (cfg.prefer && cfg.prefer.test(b.id)) - (cfg.prefer && cfg.prefer.test(a.id)) || a.id.localeCompare(b.id, 'en', { numeric: true }));
    },

    async complete({ key, model, system, prompt, images = [], json, signal, opts = {} }) {
      if (!model) throw new AIError('model', `Не выбрана модель ${cfg.title} в «Подключениях»`);
      const base = baseOf(opts);
      if (!base) throw new AIError('error', `Укажите адрес API ${cfg.title} в «Подключениях»`);
      const text = json ? prompt + '\n\nОтветь только JSON-объектом, без пояснений и без ```.' : prompt;
      const content = images.length ? [{ type: 'text', text }, ...images.map(im => ({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.base64}` } }))] : text;
      const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content }];
      const r = await request(`${base}/chat/completions`, { method: 'POST', headers: await headers(key, opts, signal), signal, timeoutMs: cfg.local ? 300000 : 120000, body: { model: modelId(model, opts), messages } });
      const msg = ((r.choices || [])[0] || {}).message || {};
      return typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map(x => x.text || '').join('') : '';
    },
  };
  // Groq: распознавание речи (Whisper) — помощник сможет слушать и с этим ключом
  if (cfg.stt) p.transcribe = async ({ key, audio, signal }) => {
    const mp = multipart([{ name: 'model', value: cfg.stt }, { name: 'language', value: 'ru' }, { name: 'response_format', value: 'json' },
      { name: 'file', filename: 'speech.wav', mime: audio.mime || 'audio/wav', data: Buffer.from(audio.base64, 'base64') }]);
    const r = await request(`${baseOf({})}/audio/transcriptions`, { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': mp.type }, rawBody: mp.body, signal, timeoutMs: 60000 });
    return String((r && r.text) || '').trim();
  };
  return p;
}

module.exports = { CATALOG, make, PROVIDERS: Object.fromEntries(CATALOG.map(c => [c.id, make(c)])) };
