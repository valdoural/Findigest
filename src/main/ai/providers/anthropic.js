'use strict';
/** Claude (Anthropic Messages API). Ключ: console.anthropic.com → API Keys. */
const { request } = require('../http');

const BASE = 'https://api.anthropic.com/v1';
const hdr = key => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' });

module.exports = {
  id: 'anthropic',
  title: 'Claude',
  vendor: 'Anthropic',
  keyName: 'anthropic_api_key',
  keyUrl: 'https://console.anthropic.com/settings/keys',
  defaultModel: 'claude-sonnet-5-5',

  /** Все модели аккаунта (постранично), новые первыми. Все модели Claude — текстовые. */
  async listModels(key) {
    const out = []; let after = '';
    for (let i = 0; i < 20; i++) {
      const r = await request(`${BASE}/models?limit=1000${after ? '&after_id=' + encodeURIComponent(after) : ''}`, { headers: hdr(key), timeoutMs: 20000 });
      for (const m of r.data || []) out.push({ id: m.id, name: m.display_name || m.id, chat: true, created: m.created_at || '' });
      if (!r.has_more || !r.last_id) break;
      after = r.last_id;
    }
    return out;
  },

  async complete({ key, model, system, prompt, images = [], json, maxTokens = 8192, signal }) {
    const content = [
      ...images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.base64 } })),
      { type: 'text', text: json ? prompt + '\n\nОтветь только JSON-объектом, без пояснений.' : prompt },
    ];
    const r = await request(`${BASE}/messages`, {
      method: 'POST', headers: hdr(key), signal,
      body: { model: model || this.defaultModel, max_tokens: maxTokens, ...(system ? { system } : {}), messages: [{ role: 'user', content }] },
    });
    return (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  },
};
