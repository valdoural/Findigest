'use strict';
/**
 * Сетевые запросы основного процесса через сетевой стек Chromium (electron.net):
 * учитываются системный прокси/VPN Windows и прокси из настроек приложения.
 */
const { net } = require('electron');

class AIError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

function codeFor(status, body) {
  const t = String(body || '').toLowerCase();
  if (status === 401 || /invalid.*(api[_ ]?key|x-api-key)|api key not valid|incorrect api key/.test(t)) return 'auth';
  if (/unsupported_country|not available in your (country|region)|location is not supported|region/.test(t) && (status === 403 || status === 400)) return 'region';
  if (status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status === 400 && /image|media|inline_data|mime/.test(t)) return 'image_rejected';
  if (status === 404) return 'model';
  if (status >= 500) return 'server';
  return 'error';
}

/**
 * Понятное объяснение ошибки сервиса ИИ вместо сырого ответа. Разбирает форматы Google, OpenAI и Anthropic:
 * квота в минуту / в сутки, бесплатный тариф, модель, через сколько повторить.
 * Возвращает { code, message, retryAfterMs }.
 */
function explain(status, text) {
  let j = null; try { j = JSON.parse(text); } catch (_) { /* не JSON */ }
  const e = (j && (j.error || j)) || {};
  const raw = String(e.message || text || '').replace(/\s+/g, ' ').trim();
  const details = Array.isArray(e.details) ? e.details : [];
  const retry = details.find(d => /RetryInfo/.test(d['@type'] || ''));
  const quota = details.find(d => /QuotaFailure/.test(d['@type'] || ''));
  const v = quota && Array.isArray(quota.violations) ? quota.violations : [];
  const sec = s => { const m = /([\d.]+)s/.exec(String(s || '')); return m ? Math.ceil(+m[1]) : null; };
  let retryAfter = retry ? sec(retry.retryDelay) : null;
  if (retryAfter == null) { const m = /retry in ([\d.]+)\s*s/i.exec(raw); if (m) retryAfter = Math.ceil(+m[1]); }
  const code = codeFor(status, text);
  if (status === 429 || /quota|rate.?limit|insufficient_quota|rate_limit_error/i.test(String(e.type || e.status || '') + ' ' + raw)) {
    const ids = v.map(x => String(x.quotaId || x.quotaMetric || '')).join(' ') + ' ' + raw;
    const model = (v.map(x => x.quotaDimensions && x.quotaDimensions.model).find(Boolean)) || (/model[:\s]+([\w.\-]+)/i.exec(raw) || [])[1] || '';
    const free = /free_tier|free tier/i.test(ids);
    const perDay = /PerDay|per day|daily/i.test(ids);
    const zero = v.some(x => String(x.quotaValue) === '0') || /limit:\s*0\b/.test(raw);
    const billing = /insufficient_quota|billing|credit balance/i.test(String(e.type || e.code || '') + ' ' + raw) && !free;
    let msg;
    if (billing) msg = 'на счёте сервиса закончились средства или не подключена оплата. Пополните баланс в кабинете сервиса или выберите другой ИИ основным в «Подключениях».';
    else if (zero && free) msg = `модель ${model || 'выбранная'} недоступна на бесплатном тарифе. В «Подключения → ИИ» выберите модель Flash (например, gemini-2.5-flash) или подключите оплату в Google AI Studio.`;
    else if (perDay) msg = `исчерпан дневной лимит${free ? ' бесплатного тарифа' : ''}${model ? ' для ' + model : ''}. Он обновится в течение суток; сейчас можно выбрать другую модель или другой ИИ основным.`;
    else msg = `слишком много запросов за минуту${free ? ' на бесплатном тарифе' : ''}${model ? ' (' + model + ')' : ''}${retryAfter ? `, повторите через ${retryAfter} с` : ', повторите через минуту'}. Если ошибка повторяется — выберите модель полегче (Flash / mini) или другой ИИ основным.`;
    return { code: billing || zero || perDay ? 'quota' : 'rate_limited', message: 'Лимит ИИ: ' + msg, retryAfterMs: !billing && !zero && !perDay && retryAfter ? retryAfter * 1000 : null };
  }
  if (/overloaded/i.test(String(e.type || '') + raw) || status === 529 || status === 503) return { code: 'server', message: 'Сервис ИИ перегружен — повторите через минуту.', retryAfterMs: 20000 };
  const human = { auth: 'Ключ API не принят — проверьте его в «Подключениях».', region: 'Сервис недоступен из вашего региона — укажите прокси в «Подключения → Сеть».', model: 'Модель не найдена — выберите другую в «Подключениях».', server: 'Ошибка на стороне сервиса ИИ — повторите позже.' }[code];
  return { code, message: human ? `${human}${raw ? ' (' + raw.slice(0, 160) + ')' : ''}` : (raw || `Ошибка ${status}`).slice(0, 300), retryAfterMs: null };
}

async function request(url, { method = 'GET', headers = {}, body, rawBody, raw = false, signal, timeoutMs = 120000 } = {}) {
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (signal) { if (signal.aborted) ac.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await net.fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json', ...headers } : headers,
      body: rawBody || (body ? JSON.stringify(body) : undefined),
      signal: ac.signal,
    });
    if (raw && res.ok) return Buffer.from(await res.arrayBuffer());
    const text = await res.text();
    if (!res.ok) { const x = explain(res.status, text); const err = new AIError(x.code, x.message, res.status); err.retryAfterMs = x.retryAfterMs; throw err; }
    try { return JSON.parse(text); } catch (_) { return text; }
  } catch (e) {
    if (e instanceof AIError) throw e;
    if (signal && signal.aborted) throw new AIError('aborted', 'Остановлено');
    if (ac.signal.aborted) throw new AIError('timeout', 'Превышено время ожидания ответа');
    throw new AIError('network', 'Нет связи с сервером: ' + (e.message || e));
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/** Достаём JSON из ответа модели (снимаем ```json … ``` и лишний текст вокруг). */
function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch (_) { /* ищем первый объект */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) { /* ниже */ } }
  throw new AIError('bad_json', 'Модель вернула ответ не в формате JSON');
}

/** multipart/form-data вручную (для загрузки аудио). parts: [{name, value} | {name, filename, mime, data:Buffer}] */
function multipart(parts) {
  const boundary = '----fd' + Date.now().toString(16) + Math.random().toString(16).slice(2);
  const chunks = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"` : ''}\r\n${p.mime ? `Content-Type: ${p.mime}\r\n` : ''}\r\n`));
    chunks.push(Buffer.isBuffer(p.data) ? p.data : Buffer.from(String(p.value)));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), type: `multipart/form-data; boundary=${boundary}` };
}

module.exports = { request, parseJson, AIError, multipart, explain };
