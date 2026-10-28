'use strict';
/**
 * «Вы против региона и РФ»: официальные ориентиры по выбранному субъекту РФ.
 * Цифры ищет подключённый ИИ (Perplexity — с поиском в интернете — первым, если подключён) при обновлении выводов
 * или кнопкой «Найти данные». Хранятся в БД (docs: region/<субъект>, region/__rf), не старше 30 дней — потом обновляются.
 * Чего ИИ не нашёл — остаётся пустым («нет данных»). Встроенные значения — только проверенные вручную (Свердловская обл., РФ).
 */
const { BrowserWindow } = require('electron');
const ai = require('../ai/router');
const D = require('../db/database');
const settings = require('../config/settings');
const log = require('../log');

const REGIONS = [
  'Республика Адыгея', 'Республика Алтай', 'Республика Башкортостан', 'Республика Бурятия', 'Республика Дагестан', 'Донецкая Народная Республика',
  'Республика Ингушетия', 'Кабардино-Балкарская Республика', 'Республика Калмыкия', 'Карачаево-Черкесская Республика', 'Республика Карелия',
  'Республика Коми', 'Республика Крым', 'Луганская Народная Республика', 'Республика Марий Эл', 'Республика Мордовия', 'Республика Саха (Якутия)',
  'Республика Северная Осетия — Алания', 'Республика Татарстан', 'Республика Тыва', 'Удмуртская Республика', 'Республика Хакасия',
  'Чеченская Республика', 'Чувашская Республика', 'Алтайский край', 'Забайкальский край', 'Камчатский край', 'Краснодарский край',
  'Красноярский край', 'Пермский край', 'Приморский край', 'Ставропольский край', 'Хабаровский край', 'Амурская область',
  'Архангельская область', 'Астраханская область', 'Белгородская область', 'Брянская область', 'Владимирская область', 'Волгоградская область',
  'Вологодская область', 'Воронежская область', 'Запорожская область', 'Ивановская область', 'Иркутская область', 'Калининградская область',
  'Калужская область', 'Кемеровская область — Кузбасс', 'Кировская область', 'Костромская область', 'Курганская область', 'Курская область',
  'Ленинградская область', 'Липецкая область', 'Магаданская область', 'Московская область', 'Мурманская область', 'Нижегородская область',
  'Новгородская область', 'Новосибирская область', 'Омская область', 'Оренбургская область', 'Орловская область', 'Пензенская область',
  'Псковская область', 'Ростовская область', 'Рязанская область', 'Самарская область', 'Саратовская область', 'Сахалинская область',
  'Свердловская область', 'Смоленская область', 'Тамбовская область', 'Тверская область', 'Томская область', 'Тульская область',
  'Тюменская область', 'Ульяновская область', 'Херсонская область', 'Челябинская область', 'Ярославская область', 'Москва',
  'Санкт-Петербург', 'Севастополь', 'Еврейская автономная область', 'Ненецкий автономный округ',
  'Ханты-Мансийский автономный округ — Югра', 'Чукотский автономный округ', 'Ямало-Ненецкий автономный округ',
];
const DEFAULT = 'Свердловская область';
const MAX_AGE = 30 * 864e5;

// проверенные вручную значения (были в отчёте) — показываются, пока ИИ не нашёл более свежие
const BUILTIN = {
  'Свердловская область': { salary: { v: 94800, p: 'апр. 2026' }, src: 'Свердловскстат', builtin: true },
  __rf: { salary: { v: 114700, p: 'июнь 2026' }, median: { v: 75000, p: 'оценка' }, savings: { v: 4.4, p: 'I пол. 2026' },
    food: { v: 21.8, p: 'II кв. 2024', note: '13,2 — верхняя группа' }, cafe: { v: 0.7, p: 'II кв. 2024' }, alcohol: { v: 1.2, p: 'II кв. 2024' },
    src: 'Росстат', builtin: true },
};
const FIELDS = { salary: [15000, 500000], median: [10000, 400000], savings: [-50, 80], food: [1, 80], cafe: [0, 30], alcohol: [0, 20] };

const get = id => { try { const r = D.db.prepare("SELECT json FROM docs WHERE collection='region' AND id=?").get(id); return r ? JSON.parse(r.json) : null; } catch (_) { return null; } };
const put = (id, v) => D.db.prepare(`INSERT INTO docs(collection,id,json,updated_at) VALUES('region',?,?,?)
  ON CONFLICT(collection,id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at`).run(id, JSON.stringify(v), Date.now());
const current = () => { const r = (settings.get().app || {}).region; return REGIONS.includes(r) ? r : DEFAULT; };
const merged = id => { const b = BUILTIN[id] || {}, s = get(id); return s ? { ...b, ...s, builtin: false } : (Object.keys(b).length ? b : null); };

function state() {
  const name = current();
  return { regions: REGIONS, name, region: merged(name), rf: merged('__rf'), running: !!running, available: ai.available(), error: lastError };
}

/** Очистка ответа ИИ: только числа в правдоподобных пределах, с периодом и источником. */
function clean(o) {
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(FIELDS)) {
    const x = o && o[k]; if (!x) continue;
    const v = typeof x === 'object' ? +x.value : +x;
    if (!Number.isFinite(v) || v < lo || v > hi) continue;
    out[k] = { v: Math.round(v * 10) / 10, p: String((x && x.period) || '').slice(0, 40) };
  }
  if (o && o.source) out.src = String(o.source).slice(0, 160);
  return out;
}

const SYSTEM = 'Ты — аналитик официальной статистики РФ (Росстат, территориальные органы статистики). Отвечай только JSON. ' +
  'Давай только опубликованные официальные значения с периодом; если значения нет или ты не уверен — null. Не выдумывай и не экстраполируй.';
const prompt = name => `Нужны последние опубликованные официальные данные для субъекта «${name}» и для РФ в целом.
Верни JSON: {"region":{"salary":{"value":число,"period":"мес. год"},"savings":{...},"food":{...},"cafe":{...},"alcohol":{...},"source":"откуда"},
"rf":{"salary":{...},"median":{...},"savings":{...},"food":{...},"cafe":{...},"alcohol":{...},"source":"откуда"}}
salary — среднемесячная начисленная номинальная заработная плата, ₽ (до налогов); median — медианная зарплата по РФ, ₽;
savings — норма сбережений населения, % доходов; food — доля продуктов питания в потребительских расходах домохозяйств, %;
cafe — доля общественного питания, %; alcohol — доля алкогольных напитков, %. Неизвестное — null.`;

let running = null, lastError = null;
function broadcast() { for (const w of BrowserWindow.getAllWindows()) try { w.webContents.send('region:updated', state()); } catch (_) { /* окно закрыто */ } }

/** Найти данные для текущего субъекта. auto — только если устарели. */
function refresh({ auto = false } = {}) {
  if (running) return running;
  const name = current(), s = get(name), rf = get('__rf');
  const fresh = x => x && x.at && Date.now() - new Date(x.at).getTime() < MAX_AGE;
  if (auto && fresh(s) && fresh(rf)) return Promise.resolve(state());
  if (!ai.available()) { lastError = 'ИИ не подключён'; return Promise.resolve(state()); }
  running = (async () => {
    broadcast();
    try {
      const r = await ai.run({ json: true, system: SYSTEM, prompt: prompt(name), prefer: ['perplexity'] });
      const at = new Date().toISOString(), reg = clean(r.result && r.result.region), all = clean(r.result && r.result.rf);
      if (Object.keys(reg).some(k => k !== 'src')) put(name, { ...reg, at, provider: r.provider });
      else put(name, { ...(s || {}), at, provider: r.provider, empty: true });
      if (Object.keys(all).some(k => k !== 'src')) put('__rf', { ...all, at, provider: r.provider });
      lastError = null;
      log.info(`Данные по региону «${name}» (${r.provider}): ${Object.keys(reg).join(', ') || 'не найдены'}`);
    } catch (e) { lastError = e.message; log.warn('Данные по региону:', e.message); } finally { running = null; broadcast(); }
    return state();
  })();
  return running;
}

function setRegion(name) {
  if (!REGIONS.includes(name)) throw new Error('Неизвестный субъект');
  settings.patch('app', { region: name });
  if (!get(name)) refresh({ auto: true }).catch(() => {});
  return state();
}

module.exports = { REGIONS, state, refresh, setRegion, clean };
