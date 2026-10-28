/**
 * Разбор таблиц квитанций ЖКХ и чеков из CSV / TXT / XLSX — без ИИ, прямо в программе.
 * Понимает файлы, выгруженные самим дайджестом («Данные → в файл»), и обычные таблицы:
 *   • кодировка: UTF-8 (с BOM и без), Windows-1251 (CSV из русского Excel), UTF-16 («Текст Юникод» из Excel);
 *   • разделитель: ; , табуляция или | — определяется сам;
 *   • заголовки ищутся в первых строках по смыслу: «Дата», «Магазин», «Товар/Наименование», «Сумма/Стоимость»,
 *     «Период», «Тип/Поставщик», «Услуга», «Количество/Объём», «Тариф»;
 *   • числа «1 234,56 ₽», даты «05.10.2026», «2026-10-05», ячейки-даты Excel, периоды «09.2026», «сентябрь 2026».
 * Результат: { it: [квитанции {p,t,n,q,r,s}], rcp: [чеки {d,st,n,s,g?}], skipped: [{row, why}], text?: 'не таблица' }.
 * Работает и в окне (window.FDTable), и в Node (тесты).
 */
(function (root) {
  'use strict';

  /* ---------- текст и кодировки ---------- */
  function decode(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
    if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8.subarray(2));
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) return new TextDecoder('utf-8').decode(u8.subarray(3));
    // UTF-16 без BOM: много нулевых байтов через один
    let z = 0; const n = Math.min(u8.length, 400);
    for (let i = 1; i < n; i += 2) if (u8[i] === 0) z++;
    if (n > 20 && z > n / 4) return new TextDecoder('utf-16le').decode(u8);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); }
    catch (_) { return new TextDecoder('windows-1251').decode(u8); }
  }

  /** Разделитель — тот, что стабильно встречается в первых строках. */
  function sniff(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 30);
    let best = null, score = 0;
    for (const d of ['\t', ';', ',', '|']) {
      const counts = lines.map(l => splitLine(l, d).length - 1).filter(c => c > 0);
      if (!counts.length) continue;
      const freq = {}; counts.forEach(c => { freq[c] = (freq[c] || 0) + 1; });
      const mode = Math.max(...Object.values(freq));
      const s = mode * 10 + counts.length + (d === '\t' || d === ';' ? 0.5 : 0); // ; и таб надёжнее запятой (запятая — в суммах)
      if (s > score) { score = s; best = d; }
    }
    return best;
  }
  function splitLine(line, d) { return parseCsv(line, d)[0] || []; }

  /** CSV с кавычками и переводами строк внутри ячеек. */
  function parseCsv(text, d) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"' && cell === '') q = true;
      else if (c === d) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  /* ---------- значения ---------- */
  const pad = n => String(n).padStart(2, '0');
  const ymdOf = dt => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const excelDate = n => { const dt = new Date(Math.round((n - 25569) * 864e5)); return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`; };
  const okYear = y => y >= 2000 && y <= 2100;

  function num(v) {
    if (typeof v === 'number') return v;
    if (v == null) return NaN;
    let s = String(v).replace(/[\s  ']/g, '').replace(/[−–—]/g, '-').replace(/(руб\.?|р\.|₽|rub)$/i, '').replace(/[^\d.,\-+]/g, '');
    if (!s || !/\d/.test(s)) return NaN;
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (lc >= 0) s = (s.match(/,/g).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.'));
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function date(v) {
    if (v instanceof Date && !isNaN(v)) return ymdOf(v);
    if (typeof v === 'number') return v > 30000 && v < 80000 ? excelDate(v) : '';
    const s = String(v || '').trim();
    let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(s);
    if (m && okYear(+m[1])) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/.exec(s);
    if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; if (okYear(y) && +m[2] >= 1 && +m[2] <= 12) return `${y}-${pad(m[2])}-${pad(m[1])}`; }
    if (/^\d{5}(\.\d+)?$/.test(s)) return excelDate(+s);
    return '';
  }

  const MON = ['янв', 'фев', 'мар', 'апр', 'ма', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  function period(v) {
    if (v instanceof Date && !isNaN(v)) return ymdOf(v).slice(0, 7);
    if (typeof v === 'number') return v > 30000 && v < 80000 ? excelDate(v).slice(0, 7) : '';
    const s = String(v || '').trim().toLowerCase();
    let m = /^(\d{4})[-./](\d{1,2})(?:[-./]\d{1,2})?\b/.exec(s);
    if (m && okYear(+m[1]) && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${pad(m[2])}`;
    m = /^(?:\d{1,2}[./-])?(\d{1,2})[./-](\d{4}|\d{2})\b/.exec(s);
    if (m) { const y = m[2].length === 2 ? 2000 + +m[2] : +m[2]; if (okYear(y) && +m[1] >= 1 && +m[1] <= 12) return `${y}-${pad(m[1])}`; }
    m = /^([а-яё]+)\.?\s+(\d{4})/.exec(s);
    if (m) { const w = m[1].replace('ё', 'е'); const i = w.startsWith('ма') ? (w.startsWith('мар') ? 2 : 4) : MON.findIndex(x => w.startsWith(x)); if (i >= 0 && okYear(+m[2])) return `${m[2]}-${pad(i + 1)}`; }
    if (/^\d{5}(\.\d+)?$/.test(s)) return excelDate(+s).slice(0, 7);
    return '';
  }

  const text = v => (v instanceof Date ? ymdOf(v) : v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();

  /* ---------- заголовки ---------- */
  const norm = s => text(s).toLowerCase().replace(/ё/g, 'е').replace(/[,()]*\s*(₽|руб\.?|р\.)\s*\)?$/, '').trim();
  const FIELDS = {
    rcp: [
      ['d', /^(дата|date|день|время)/],
      ['st', /(магазин|продав|торгов|точка|store|shop|организац)/],
      ['n', /(товар|наименован|название|позиц|продукт|item|product|^name)/],
      ['g', /(групп|категор|group|category)/],
      ['s', /(сумм|стоимост|итого|amount|total|^sum)/],
      ['price', /(цена|price)/],
      ['qty', /(кол-?во|количеств|^кол|qty|quantity)/],
    ],
    it: [
      ['p', /(период|месяц|period|month)/],
      ['t', /^(тип|поставщик|организац|квитанц|исполнител|type|provider)/],
      ['n', /(услуг|наименован|позиц|статья|service|^name)/],
      ['q', /(количеств|кол-?во|объем|расход|показан|qty|volume)/],
      ['r', /(тариф|цена|rate)/],
      ['s', /(сумм|начислен|к оплате|итого|стоимост|amount|^sum)/],
    ],
  };
  function mapHeader(cells, kind) {
    const h = cells.map(norm), used = new Set(), map = {};
    for (const [f, re] of FIELDS[kind]) {
      const i = h.findIndex((c, j) => c && !used.has(j) && re.test(c));
      if (i >= 0) { map[f] = i; used.add(i); }
    }
    return map;
  }
  /** Ищем строку заголовков и тип таблицы среди первых 15 строк. */
  function findHeader(rows, hint) {
    let best = null;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      for (const kind of ['it', 'rcp']) {
        const m = mapHeader(rows[i], kind);
        if (m.n == null || (m.s == null && !(kind === 'rcp' && m.price != null))) continue;
        const hn = norm(rows[i][m.n]), hr = m.r != null ? norm(rows[i][m.r]) : '';
        let sc = Object.keys(m).length;
        if (kind === 'it' && (m.p != null || m.t != null || /тариф/.test(hr))) sc += 1.5;
        if (kind === 'it' && /услуг/.test(hn)) sc += 1;
        if (kind === 'rcp' && (m.d != null || m.st != null)) sc += 1.5;
        if (kind === 'rcp' && /товар|продукт|покупк/.test(hn)) sc += 1;
        if (kind === hint) sc += 0.5; // откуда начат импорт: лист ЖКХ или «Продукты»
        if (!best || sc > best.score) best = { row: i, kind, map: m, score: sc };
      }
    }
    return best && best.score >= 3 ? best : null;
  }

  const TYPES = ['УК', 'ЭСК', 'ЕРЦ ВС'];
  function billType(v) {
    const s = text(v), l = s.toLowerCase();
    const exact = TYPES.find(t => t.toLowerCase() === l);
    if (exact) return exact;
    if (/эск|энергосбыт|электр/.test(l)) return 'ЭСК';
    if (/ерц|водоканал|водоснаб|(^|[^а-яё])вс($|[^а-яё])/.test(l)) return 'ЕРЦ ВС';
    return 'УК';
  }
  const TOTAL = /^(итого|всего|итог|total)(?![а-яёa-z])/i; // \b в JS не видит границу кириллических слов

  /**
   * rows — массив строк таблицы; opts.date / opts.store — что подставить, если в таблице нет даты/магазина.
   */
  function fromRows(rows, opts = {}, sheet = '') {
    const out = { it: [], rcp: [], skipped: [], sheets: [] };
    rows = rows.filter(r => r && r.some(c => text(c) !== ''));
    const h = findHeader(rows, opts.kind);
    if (!h) return out;
    out.sheets.push({ sheet, kind: h.kind, header: h.row + 1 });
    const m = h.map, get = (r, f) => (m[f] == null ? '' : r[m[f]]);
    for (let i = h.row + 1; i < rows.length; i++) {
      const r = rows[i], n = text(get(r, 'n')), at = (sheet ? sheet + ', ' : '') + 'строка ' + (i + 1);
      if (!n && !text(get(r, 's'))) continue;
      if (TOTAL.test(n) || TOTAL.test(text(r[0]))) continue;
      if (!n) { out.skipped.push({ row: at, why: 'нет названия' }); continue; }
      if (h.kind === 'it') {
        const p = period(get(r, 'p')) || opts.period || '';
        const s = num(get(r, 's'));
        if (!p) { out.skipped.push({ row: at, why: 'не распознан период' }); continue; }
        if (!Number.isFinite(s)) { out.skipped.push({ row: at, why: 'нет суммы' }); continue; }
        const q = num(get(r, 'q')), rt = num(get(r, 'r'));
        out.it.push({ p, t: billType(get(r, 't')), n, q: Number.isFinite(q) ? q : 0, r: Number.isFinite(rt) ? rt : 0, s: Math.round(s * 100) / 100 });
      } else {
        const d = date(get(r, 'd')) || opts.date || '';
        let s = num(get(r, 's'));
        if (!Number.isFinite(s) && m.price != null) { const p = num(get(r, 'price')), q = num(get(r, 'qty')); if (Number.isFinite(p)) s = p * (Number.isFinite(q) ? q : 1); }
        if (!d) { out.skipped.push({ row: at, why: 'не распознана дата' }); continue; }
        if (!Number.isFinite(s) || s === 0) { out.skipped.push({ row: at, why: 'нет суммы' }); continue; }
        const x = { d, st: text(get(r, 'st')) || opts.store || 'Без магазина', n, s: Math.round(s * 100) / 100 };
        const g = text(get(r, 'g')); if (g) x.g = g;
        out.rcp.push(x);
      }
    }
    return out;
  }

  const merge = (a, b) => ({ it: a.it.concat(b.it), rcp: a.rcp.concat(b.rcp), skipped: a.skipped.concat(b.skipped), sheets: a.sheets.concat(b.sheets) });

  /** Текстовый файл (CSV/TXT/TSV). Если таблицы нет — вернётся text: это, скорее всего, текст чека для разбора ИИ. */
  function fromText(str, opts = {}) {
    const t = String(str || '').replace(/^﻿/, '');
    const d = sniff(t);
    const res = d ? fromRows(parseCsv(t, d), opts) : { it: [], rcp: [], skipped: [], sheets: [] };
    if (!res.sheets.length) res.text = t;
    return res;
  }

  /** Книга Excel: каждый лист разбирается отдельно (можно держать квитанции и чеки на разных листах). */
  function fromWorkbook(X, buf, opts = {}) {
    const wb = X.read(buf, { type: 'array', cellDates: true });
    let res = { it: [], rcp: [], skipped: [], sheets: [] };
    for (const name of wb.SheetNames) {
      const rows = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
      res = merge(res, fromRows(rows, opts, wb.SheetNames.length > 1 ? `лист «${name}»` : ''));
    }
    return res;
  }

  const isSheet = name => /\.(xlsx|xlsm|xls|ods)$/i.test(name || '');
  const isTable = name => /\.(csv|tsv|txt|xlsx|xlsm|xls|ods)$/i.test(name || '');

  /** Файл из окна: File + функция загрузки библиотеки XLSX. */
  async function fromFile(file, loadXlsx, opts = {}) {
    const buf = await file.arrayBuffer();
    if (isSheet(file.name)) return fromWorkbook(await loadXlsx(), buf, opts);
    return fromText(decode(buf), opts);
  }

  const api = { decode, sniff, parseCsv, num, date, period, billType, fromRows, fromText, fromWorkbook, fromFile, isTable, isSheet };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.FDTable = api;
})(typeof window !== 'undefined' ? window : globalThis);
