'use strict';
/**
 * Логотипы банков и магазинов из интернета.
 *   Источник по порядку: значок с сайта самого банка/магазина (apple-touch-icon) → сервис значков Google → favicon.ico.
 *   Картинка проверяется (декодируется, не меньше 32 px), уменьшается до 64×64 и хранится в БД (таблица logos):
 *   найденные — 30 дней, ненайденные — 7 дней (чтобы не стучаться каждый раз). Отключается в «Подключения → Сеть».
 * Магазины сопоставляются с сайтами по названию (STORES); банки — по сайту из Zenmoney или BANK_SITE в build.js.
 */
const { net, nativeImage } = require('electron');
const D = require('./db/database');
const settings = require('./config/settings');
const log = require('./log');

const OK_TTL = 30 * 864e5, MISS_TTL = 7 * 864e5;
// Сети магазинов, кафе и сервисов доставки → сайт
const STORES = [
  [/магнит/i, 'magnit.ru'], [/пят[её]рочк|5ka/i, '5ka.ru'], [/перекр[её]ст/i, 'perekrestok.ru'], [/лента/i, 'lenta.com'],
  [/ашан|auchan/i, 'auchan.ru'], [/о['’`]?к[еэ]й|okey/i, 'okmarket.ru'], [/вкусвилл/i, 'vkusvill.ru'], [/дикси/i, 'dixy.ru'],
  [/чижик/i, 'chizhik.club'], [/азбука вкуса/i, 'av.ru'], [/бристоль/i, 'bristol.ru'], [/красное.{0,3}белое/i, 'krasnoeibeloe.ru'],
  [/монетка/i, 'monetka.ru'], [/fix ?price|фикс ?прайс/i, 'fix-price.com'], [/яндекс.{0,3}лавк/i, 'lavka.yandex.ru'], [/самокат/i, 'samokat.ru'],
  [/ozon|озон/i, 'ozon.ru'], [/wildberries|вайлдберриз/i, 'wildberries.ru'], [/metro|метро кэш/i, 'metro-cc.ru'], [/глобус/i, 'globus.ru'],
  [/верный/i, 'verno-info.ru'], [/купер|сбермаркет/i, 'kuper.ru'], [/вкусно.{0,3}и точка/i, 'vkusnoitochka.ru'], [/rostic|ростикс/i, 'rostics.ru'],
  [/бургер кинг|burger king/i, 'burgerking.ru'], [/яндекс.{0,3}еда/i, 'eda.yandex.ru'], [/спортмастер/i, 'sportmaster.ru'], [/леруа|лемана/i, 'lemanapro.ru'],
  [/икеа|ikea/i, 'ikea.com'], [/м\.?видео/i, 'mvideo.ru'], [/эльдорадо/i, 'eldorado.ru'], [/днс|dns/i, 'dns-shop.ru'], [/золотое яблоко/i, 'goldapple.ru'],
  [/л['’`]?этуаль|letu/i, 'letu.ru'], [/улыбка радуги/i, 'r-ulybka.ru'], [/аптека ру|apteka\.ru/i, 'apteka.ru'], [/ригла/i, 'rigla.ru'],
];
const storeSite = name => (STORES.find(x => x[0].test(name || '')) || [])[1] || '';
const valid = d => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d || '');

// Источники значков; в тестах подменяются на локальный сервер
let SOURCES = [
  d => `https://${d}/apple-touch-icon.png`,
  d => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=128`,
  d => `https://${d}/favicon.ico`,
];

async function fetchImage(url) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await net.fetch(url, { signal: ac.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (type && !/image|octet-stream/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100 || buf.length > 2e6) return null;
    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    if (width < 32 || height < 32) return null; // заглушки «глобус» 16×16 и крошечные значки не берём
    return img.resize({ width: 64, height: 64, quality: 'best' }).toDataURL();
  } catch (_) { return null; } finally { clearTimeout(t); }
}

const inflight = new Map();
async function forDomain(domain) {
  if (!valid(domain)) return null;
  const row = D.db.prepare('SELECT data, fetched_at FROM logos WHERE domain=?').get(domain);
  if (row && Date.now() - row.fetched_at < (row.data ? OK_TTL : MISS_TTL)) return row.data || null;
  if (inflight.has(domain)) return inflight.get(domain);
  const p = (async () => {
    let data = null, source = null;
    for (const [i, src] of SOURCES.entries()) { data = await fetchImage(src(domain)); if (data) { source = String(i); break; } }
    // нет сети — не запоминаем промах, попробуем в следующий раз; старую картинку оставляем
    if (!data && row && row.data) return row.data;
    D.db.prepare(`INSERT INTO logos(domain,data,source,fetched_at) VALUES(?,?,?,?)
      ON CONFLICT(domain) DO UPDATE SET data=excluded.data, source=excluded.source, fetched_at=excluded.fetched_at`).run(domain, data, source, Date.now());
    if (data) log.info('Логотип:', domain); 
    return data;
  })().finally(() => inflight.delete(domain));
  inflight.set(domain, p);
  return p;
}

/** items: [{ name, site? }] → { [name]: dataURL } (только найденные). Сайт: указанный, иначе по названию магазина. */
async function get(items) {
  if (settings.get().network.logos === false) return {};
  const out = {};
  const list = (items || []).slice(0, 80).map(x => ({ name: String(x.name || ''), site: String(x.site || '').toLowerCase() || storeSite(x.name) })).filter(x => x.site);
  await Promise.all(list.map(async x => { const d = await forDomain(x.site); if (d) out[x.name] = d; }));
  return out;
}

module.exports = { get, storeSite, forDomain, STORES, _setSources: s => { SOURCES = s; } };
