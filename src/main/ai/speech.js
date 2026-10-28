'use strict';
/**
 * Озвучка ответов помощника живыми голосами.
 *   openai — gpt-4o-mini-tts: голоса marin/cedar (самые естественные по документации OpenAI) и инструкция «как говорить»;
 *   gemini — речевые модели Gemini (*-tts) через Interactions API: 30 голосов, стиль задаётся описанием;
 *   yandex — Yandex SpeechKit (API v1): русские голоса, ударения знаком «+» перед гласной;
 *   auto   — лучший доступный по ключам: OpenAI → Gemini → Yandex; иначе окно говорит голосом Windows.
 * Перед синтезом текст готовится к чтению вслух (prepare): «₽», «%», сокращения, знаки, разряды чисел.
 */
const settings = require('../config/settings');
const secrets = require('../config/secrets');
const { request, AIError } = require('./http');
const log = require('../log');

const STYLE_RU = 'Говори по-русски естественно и тепло, как живой человек в спокойном разговоре: в среднем темпе, с правильными ударениями, ' +
  'делай паузы на запятых и точках, понижай интонацию в конце утверждений. Числа и суммы произноси полностью и разборчиво.';

const VOICES = {
  openai: [['marin', 'Marin — женский, самый естественный'], ['cedar', 'Cedar — мужской, самый естественный'], ['coral', 'Coral — женский, тёплый'], ['sage', 'Sage — женский, спокойный'],
    ['ash', 'Ash — мужской, мягкий'], ['ballad', 'Ballad — мужской, выразительный'], ['verse', 'Verse — мужской'], ['alloy', 'Alloy — нейтральный'], ['nova', 'Nova — женский'],
    ['shimmer', 'Shimmer — женский'], ['echo', 'Echo — мужской'], ['onyx', 'Onyx — мужской, низкий'], ['fable', 'Fable — мужской']],
  gemini: [['Sulafat', 'Sulafat — тёплый'], ['Achird', 'Achird — дружелюбный'], ['Vindemiatrix', 'Vindemiatrix — мягкий'], ['Despina', 'Despina — ровный'], ['Algieba', 'Algieba — ровный'],
    ['Charon', 'Charon — деловой'], ['Kore', 'Kore — уверенный'], ['Schedar', 'Schedar — спокойный'], ['Achernar', 'Achernar — тихий'], ['Iapetus', 'Iapetus — чёткий'],
    ['Erinome', 'Erinome — чёткий'], ['Callirrhoe', 'Callirrhoe — непринуждённый'], ['Umbriel', 'Umbriel — непринуждённый'], ['Gacrux', 'Gacrux — зрелый'], ['Sadaltager', 'Sadaltager — знающий'],
    ['Aoede', 'Aoede — лёгкий'], ['Zephyr', 'Zephyr — яркий'], ['Puck', 'Puck — бодрый'], ['Leda', 'Leda — молодой'], ['Orus', 'Orus — твёрдый'], ['Enceladus', 'Enceladus — с придыханием'],
    ['Rasalgethi', 'Rasalgethi — информативный'], ['Alnilam', 'Alnilam — твёрдый'], ['Pulcherrima', 'Pulcherrima — напористый'], ['Zubenelgenubi', 'Zubenelgenubi — свободный'],
    ['Sadachbia', 'Sadachbia — живой'], ['Laomedeia', 'Laomedeia — бодрый'], ['Autonoe', 'Autonoe — яркий'], ['Algenib', 'Algenib — с хрипотцой'], ['Fenrir', 'Fenrir — возбуждённый']],
  yandex: [['alena', 'Алёна — женский'], ['filipp', 'Филипп — мужской'], ['jane', 'Джейн — женский'], ['ermil', 'Ермил — мужской'], ['omazh', 'Омаж — женский'], ['zahar', 'Захар — мужской'], ['madirus', 'Мадирус — мужской']],
};
const DEFAULT_VOICE = { openai: 'marin', gemini: 'Sulafat', yandex: 'alena' };

/* ---------- текст для чтения вслух ---------- */
const plural = (n, one, few, many) => { const a = Math.abs(n) % 10, b = Math.abs(n) % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };
function prepare(src) {
  let t = String(src || '');
  t = t.replace(/\*\*|__|`|#+\s/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\n+/g, '. ');
  t = t.replace(/(\d)[   ](?=\d{3}\b)/g, '$1');                            // 1 234 567 → 1234567 (иначе читается по группам)
  const BIG = { 'тыс': ['тысяча', 'тысячи', 'тысяч'], 'млн': ['миллион', 'миллиона', 'миллионов'], 'млрд': ['миллиард', 'миллиарда', 'миллиардов'] };
  const big = (a, b, k) => { const f = BIG[k.replace('.', '')]; return b ? f[1] : plural(+a, ...f); };
  t = t.replace(/(\d+)(?:[.,](\d+))?\s*(тыс\.?|млн|млрд)\s*₽/g, (m, a, b, k) => `${a}${b ? ',' + b : ''} ${big(a, b, k)} рублей`);
  t = t.replace(/(\d+)(?:[.,](\d+))?\s*(тыс\.?|млн|млрд)(?![а-яё])/g, (m, a, b, k) => `${a}${b ? ',' + b : ''} ${big(a, b, k)}`);
  t = t.replace(/([−-]?\d+)(?:[.,](\d+))?\s*₽/g, (m, a, b) => `${a.replace('−', 'минус ')}${b ? ',' + b : ''} ${b ? 'рубля' : plural(+a.replace('−', '-'), 'рубль', 'рубля', 'рублей')}`);
  t = t.replace(/₽/g, 'рублей').replace(/\bруб\.?/g, 'рублей');
  t = t.replace(/(\d+)(?:[.,](\d+))?\s*%/g, (m, a, b) => `${a}${b ? ',' + b : ''} ${b ? 'процента' : plural(+a, 'процент', 'процента', 'процентов')}`);
  // \b в JS не видит границ кириллических слов — границы задаём явно
  const W = '(?<![а-яёА-ЯЁ])';
  t = t.replace(new RegExp(W + 'тыс\\.?(?=[\\s,.;]|$)', 'g'), 'тысяч').replace(new RegExp(W + 'млн(?![а-яё])', 'g'), 'миллионов').replace(new RegExp(W + 'млрд(?![а-яё])', 'g'), 'миллиардов');
  t = t.replace(/\/\s*мес\.?/g, ' в месяц').replace(new RegExp(W + 'мес\\.?(?=[\\s,;]|$)', 'g'), 'месяцев').replace(/(^|[^а-яё])([вВ]\s+)?(\d{4})\s*г(\.?)(?![а-яё])/g, (m, p, v, y, d) => `${p}${v || ''}${y} ${v ? 'году' : 'год'}${d && /^\s+[А-ЯЁA-Z]/.test(t.slice(t.indexOf(m) + m.length)) ? '.' : ''}`)
    .replace(new RegExp(W + 'т\\.\\s?е\\.', 'gi'), m => (/Т/.test(m) ? 'То есть' : 'то есть')).replace(new RegExp(W + 'т\\.\\s?к\\.', 'gi'), m => (/Т/.test(m) ? 'Так как' : 'так как')).replace(new RegExp(W + 'и т\\.\\s?д\\.', 'g'), 'и так далее');
  t = t.replace(/≈\s*/g, 'примерно ').replace(/\s*[·•|]\s*/g, ', ').replace(/\s*[—–]\s*/g, ' — ').replace(/…/g, '.').replace(/\+(\d)/g, 'плюс $1').replace(/−(\d)/g, 'минус $1');
  t = t.replace(/«|»|"/g, '').replace(/\(([^)]*)\)/g, ', $1,').replace(/\s+,/g, ',').replace(/,{2,}/g, ',').replace(/,\s*([.;!?])/g, '$1').replace(/,\s*$/, '').replace(/\s{2,}/g, ' ').trim();
  return t.slice(0, 3000);
}

/* ---------- WAV из PCM (Gemini может вернуть «сырой» звук) ---------- */
function wav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/* ---------- движки ---------- */
const keyOf = n => secrets.get(n);
const ENGINES = {
  openai: {
    title: 'OpenAI', ready: () => !!keyOf('openai_api_key'),
    async speak(text, voice) {
      const key = keyOf('openai_api_key');
      const m = await require('./providers/openai').speechModels(key);
      if (!m.tts) throw new AIError('model', 'Для ключа OpenAI нет модели озвучки');
      const rich = /gpt-4o.*tts/.test(m.tts);
      const v = rich ? voice : (['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'].includes(voice) ? voice : 'coral');
      const buf = await request('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { authorization: 'Bearer ' + key }, raw: true, timeoutMs: 60000,
        body: { model: m.tts, voice: v, input: text, response_format: 'mp3', ...(rich ? { instructions: STYLE_RU } : {}) } });
      return { mime: 'audio/mpeg', base64: buf.toString('base64') };
    },
  },
  gemini: {
    title: 'Gemini', ready: () => !!keyOf('gemini_api_key'),
    model() {
      const list = (((settings.get().ai.modelLists || {}).gemini || {}).list || []).map(m => m.id).filter(id => /tts/.test(id));
      return list.find(id => /flash/.test(id) && !/lite/.test(id) && !/preview/.test(id)) || list.find(id => /flash/.test(id) && !/lite/.test(id)) || list[0] || 'gemini-2.5-flash-preview-tts';
    },
    async speak(text, voice) {
      const key = keyOf('gemini_api_key'), model = this.model(), hdr = { 'x-goog-api-key': key };
      try {
        const r = await request('https://generativelanguage.googleapis.com/v1beta/interactions', { method: 'POST', headers: hdr, timeoutMs: 90000, body: {
          model, input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style: STYLE_RU }] }] }],
          response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice }] } } });
        const steps = (r && r.steps) || [];
        const audio = steps.filter(s => s.type === 'model_output').flatMap(s => s.content || []).filter(c => c.type === 'audio').pop();
        if (audio && audio.data) {
          const buf = Buffer.from(audio.data, 'base64');
          return { mime: 'audio/wav', base64: (buf.subarray(0, 4).toString() === 'RIFF' ? buf : wav(buf)).toString('base64') };
        }
        throw new AIError('error', 'пустой ответ');
      } catch (e) {
        if (e.code === 'quota' || e.code === 'rate_limited' || e.code === 'auth') throw e;
        // запасной путь — generateContent с аудио-ответом
        const r = await request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: hdr, timeoutMs: 90000, body: {
          contents: [{ role: 'user', parts: [{ text: `${STYLE_RU}\n\nПрочитай вслух: ${text}` }] }],
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } } });
        const part = ((((r.candidates || [])[0] || {}).content || {}).parts || []).find(p => p.inlineData || p.inline_data);
        const d = part && (part.inlineData || part.inline_data);
        if (!d || !d.data) throw new AIError('error', 'Gemini не вернул звук');
        const rate = +((/rate=(\d+)/.exec(d.mimeType || d.mime_type || '') || [])[1] || 24000);
        return { mime: 'audio/wav', base64: wav(Buffer.from(d.data, 'base64'), rate).toString('base64') };
      }
    },
  },
  yandex: {
    title: 'Yandex SpeechKit', ready: () => !!keyOf('yandex_api_key'),
    async speak(text, voice) {
      const folder = ((settings.get().ai.extra || {}).yandex || {}).folder || '';
      const form = new URLSearchParams({ text, lang: 'ru-RU', voice, speed: '1.0', format: 'oggopus', ...(folder ? { folderId: folder } : {}) });
      const buf = await request('https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize', { method: 'POST', raw: true, timeoutMs: 60000,
        headers: { authorization: 'Api-Key ' + keyOf('yandex_api_key'), 'content-type': 'application/x-www-form-urlencoded' }, rawBody: Buffer.from(form.toString()) });
      return { mime: 'audio/ogg', base64: buf.toString('base64') };
    },
  },
};
const ORDER = ['openai', 'gemini', 'yandex'];

function engineFor(pref) {
  if (pref && ENGINES[pref]) return ENGINES[pref].ready() ? pref : null;
  return ORDER.find(id => ENGINES[id].ready()) || null;     // auto
}

/** Озвучить: { mime, base64, engine } или ошибка no_tts (тогда окно говорит голосом Windows). */
async function speak(text) {
  const a = settings.get().assistant || {};
  const id = engineFor(a.tts === 'auto' ? null : a.tts);
  if (!id) throw new AIError('no_tts', 'Нет ключа для живого голоса — говорю голосом Windows. Подключите GPT, Gemini или YandexGPT.');
  const voice = (a.voices || {})[id] || (id === 'openai' && a.openaiVoice) || DEFAULT_VOICE[id];
  const t0 = Date.now();
  const r = await ENGINES[id].speak(prepare(text), voice);
  log.info(`Озвучка ${id}/${voice}: ${Date.now() - t0} мс`);
  return { ...r, engine: id };
}

function info() {
  return { engines: Object.fromEntries(Object.entries(ENGINES).map(([id, e]) => [id, { title: e.title, ready: e.ready(), voices: VOICES[id], def: DEFAULT_VOICE[id] }])), auto: engineFor(null) };
}

module.exports = { speak, info, prepare, wav, VOICES, ENGINES };
