'use strict';
/** GPT (OpenAI Chat Completions). Ключ: platform.openai.com → API keys. */
const { request, multipart } = require('../http');

const BASE = 'https://api.openai.com/v1';
const hdr = key => ({ authorization: 'Bearer ' + key });

module.exports = {
  id: 'openai',
  title: 'GPT',
  vendor: 'OpenAI',
  keyName: 'openai_api_key',
  keyUrl: 'https://platform.openai.com/api-keys',
  defaultModel: '',

  /** Все модели ключа; chat — подходят для текста (отчёт, помощник), остальные показываются отдельной группой. */
  async listModels(key) {
    const r = await request(`${BASE}/models`, { headers: hdr(key), timeoutMs: 20000 });
    const chat = id => /^(gpt-|o\d|chatgpt-)/.test(id) && !/(audio|realtime|tts|transcribe|search|image|embedding|instruct|moderation)/.test(id);
    return (r.data || [])
      .map(m => ({ id: m.id, name: m.id, chat: chat(m.id), created: m.created || 0 }))
      .sort((a, b) => (b.chat - a.chat) || (b.created - a.created) || b.id.localeCompare(a.id));
  },

  /** Выбор модели речи из того, что доступно ключу (без угадывания имён). */
  async speechModels(key) {
    if (this._sm && this._sm.key === key) return this._sm;
    const r = await request(`${BASE}/models`, { headers: hdr(key), timeoutMs: 20000 });
    const ids = (r.data || []).map(m => m.id);
    const first = list => list.find(x => ids.includes(x)) || ids.find(x => list.some(l => x.startsWith(l)));
    this._sm = { key, stt: first(['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1']), tts: first(['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd']) };
    return this._sm;
  },

  async transcribe({ key, audio, signal }) {
    const m = await this.speechModels(key);
    if (!m.stt) throw Object.assign(new Error('Для этого ключа OpenAI нет модели распознавания речи'), { code: 'model' });
    const mp = multipart([
      { name: 'model', value: m.stt }, { name: 'language', value: 'ru' }, { name: 'response_format', value: 'json' },
      { name: 'file', filename: 'speech.wav', mime: audio.mime || 'audio/wav', data: Buffer.from(audio.base64, 'base64') },
    ]);
    const r = await request(`${BASE}/audio/transcriptions`, { method: 'POST', headers: { ...hdr(key), 'content-type': mp.type }, rawBody: mp.body, signal, timeoutMs: 60000 });
    return String((r && r.text) || '').trim();
  },

  async speak({ key, text, voice = 'alloy', signal }) {
    const m = await this.speechModels(key);
    if (!m.tts) throw Object.assign(new Error('Для этого ключа OpenAI нет модели озвучки'), { code: 'model' });
    const buf = await request(`${BASE}/audio/speech`, { method: 'POST', headers: hdr(key), raw: true, signal, timeoutMs: 60000,
      body: { model: m.tts, voice, input: String(text).slice(0, 3000), response_format: 'mp3' } });
    return { mime: 'audio/mpeg', base64: buf.toString('base64') };
  },

  async complete({ key, model, system, prompt, images = [], json, signal }) {
    if (!model) throw Object.assign(new Error('Не выбрана модель GPT в «Подключениях»'), { code: 'model' });
    const content = [
      { type: 'text', text: json ? prompt + '\n\nОтветь только JSON-объектом.' : prompt },
      ...images.map(im => ({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.base64}` } })),
    ];
    const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content }];
    const r = await request(`${BASE}/chat/completions`, {
      method: 'POST', headers: hdr(key), signal,
      body: { model, messages, ...(json ? { response_format: { type: 'json_object' } } : {}) },
    });
    return ((r.choices || [])[0] || {}).message?.content || '';
  },
};
