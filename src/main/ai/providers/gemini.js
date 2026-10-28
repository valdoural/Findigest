'use strict';
/** Gemini (Google AI Studio, Generative Language API). Ключ: aistudio.google.com → Get API key. */
const { request } = require('../http');

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const hdr = key => ({ 'x-goog-api-key': key });
const rank = id => (/preview|exp|latest/.test(id) ? 4 : 0) + (/flash-lite/.test(id) ? 1 : /flash/.test(id) ? 0 : /pro/.test(id) ? 2 : 3);

module.exports = {
  id: 'gemini',
  title: 'Gemini',
  vendor: 'Google',
  keyName: 'gemini_api_key',
  keyUrl: 'https://aistudio.google.com/app/apikey',
  defaultModel: '',

  /** Все модели ключа (постранично); chat — генерируют текст (generateContent), остальные — отдельной группой. */
  async listModels(key) {
    const all = []; let token = '';
    for (let i = 0; i < 20; i++) {
      const r = await request(`${BASE}/models?pageSize=1000${token ? '&pageToken=' + encodeURIComponent(token) : ''}`, { headers: hdr(key), timeoutMs: 20000 });
      all.push(...(r.models || []));
      if (!r.nextPageToken) break;
      token = r.nextPageToken;
    }
    const chat = m => (m.supportedGenerationMethods || []).includes('generateContent') && !/(embedding|tts|image-generation|-image|live|aqa)/.test(m.name);
    return all
      .map(m => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name, chat: chat(m) }))
      // первыми — стабильные Flash: у них самые щедрые бесплатные лимиты; Pro и предварительные версии — ниже
      .sort((a, b) => (b.chat - a.chat) || rank(a.id) - rank(b.id) || b.id.localeCompare(a.id, 'en', { numeric: true }));
  },

  /** Расшифровка речи: та же мультимодальная модель, аудио передаётся во вложении. */
  async transcribe({ key, model, audio, signal }) {
    if (!model) throw Object.assign(new Error('Не выбрана модель Gemini в «Подключениях»'), { code: 'model' });
    const r = await request(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: hdr(key), signal, timeoutMs: 60000,
      body: { contents: [{ role: 'user', parts: [{ inline_data: { mime_type: audio.mime || 'audio/wav', data: audio.base64 } },
        { text: 'Дословно расшифруй речь на русском языке. Верни только текст сказанного, без пояснений и кавычек. Если речи нет — верни пустую строку.' }] }] },
    });
    const c = (r.candidates || [])[0];
    return ((c && c.content && c.content.parts) || []).map(p => p.text || '').join('').trim();
  },

  async complete({ key, model, system, prompt, images = [], json, signal }) {
    if (!model) throw Object.assign(new Error('Не выбрана модель Gemini в «Подключениях»'), { code: 'model' });
    const parts = [
      ...images.map(im => ({ inline_data: { mime_type: im.mime, data: im.base64 } })),
      { text: prompt },
    ];
    const r = await request(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: hdr(key), signal,
      body: {
        ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
        contents: [{ role: 'user', parts }],
        ...(json ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
      },
    });
    const c = (r.candidates || [])[0];
    return ((c && c.content && c.content.parts) || []).map(p => p.text || '').join('');
  },
};
