/**
 * Импорт квитанций и чеков из таблиц: CSV, TXT, XLSX (кроме JSON-копии дайджеста).
 *   • «Данные → Импорт из файла» — JSON как раньше, таблицы разбираются здесь;
 *   • лист ЖКХ → «Архив квитанций» — кнопка «Таблица квитанций»;
 *   • лист «Продукты» → «Импорт чека» — таблицы в зоне перетаскивания импортируются сразу, фото/PDF/текст чека идут ИИ как раньше.
 * Перед добавлением показывается, что найдено; дубликаты (те же период+тип+услуга или дата+магазин+товар+сумма) пропускаются.
 * Записи попадают в те же наборы, что и ручной ввод, — и в отдельную базу (receipt_items / bill_items).
 */
(function () {
  'use strict';
  const T = window.FDTable;
  if (!T) return;
  const $ = id => document.getElementById(id);
  const say = (id, t) => { const e = $(id); if (e) e.textContent = t; };
  const N0 = v => Math.round(v).toLocaleString('ru-RU');
  const TABLES = '.csv,.tsv,.txt,.xlsx,.xlsm,.xls,.ods';
  // данные и функции отчёта публикует его основной скрипт (window.FD_PAGE) после загрузки данных
  const PG = () => window.FD_PAGE || {};
  const XL = () => (PG().loadXlsx ? PG().loadXlsx() : Promise.reject(new Error('xlsx')));

  /* ---------- слияние в данные отчёта ---------- */
  function apply(res) {
    const P = PG(), IT = P.IT, CS = P.CS, CG = P.CG;
    let ai = 0, ad = 0, ri = 0, rd = 0;
    if (res.it.length) {
      const seen = new Set(IT.map(x => x.p + '|' + x.t + '|' + x.n));
      for (const x of res.it) { const k = x.p + '|' + x.t + '|' + x.n; if (seen.has(k)) { ad++; continue; } seen.add(k); IT.push({ ...x }); ai++; }
      CS('it', IT);
    }
    if (res.rcp.length) {
      const cur = CG('rcp', []), seen = new Set(cur.map(x => x.d + x.st + x.n + x.s));
      for (const x of res.rcp) { const k = x.d + x.st + x.n + x.s; if (seen.has(k)) { rd++; continue; } seen.add(k); cur.push({ ...x, rid: 'imp-' + x.d + '-' + x.st }); ri++; }
      P.RCP = cur; CS('rcp', cur);
    }
    try { P.renderAll(); } catch (_) { /* лист ещё не построен */ }
    try { P.sRefresh(); } catch (_) { /* нет листа «Продукты» */ }
    return { ai, ad, ri, rd };
  }

  const span = (arr, key) => { const v = arr.map(x => x[key]).sort(); return v.length ? (v[0] === v[v.length - 1] ? v[0] : v[0] + ' … ' + v[v.length - 1]) : ''; };
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return n + ' ' + (a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many); };
  function summary(res) {
    const parts = [];
    if (res.it.length) parts.push(`квитанции ЖКХ: ${plural(res.it.length, 'строка', 'строки', 'строк')}, период${span(res.it, 'p').includes('…') ? 'ы' : ''} ${span(res.it, 'p')}, на ${N0(res.it.reduce((s, x) => s + x.s, 0))} ₽`);
    if (res.rcp.length) parts.push(`чеки: ${plural(res.rcp.length, 'позиция', 'позиции', 'позиций')}, ${span(res.rcp, 'd')}, на ${N0(res.rcp.reduce((s, x) => s + x.s, 0))} ₽`);
    return parts.join('; ');
  }
  const skippedNote = res => (res.skipped.length ? ` Пропущено: ${plural(res.skipped.length, 'строка', 'строки', 'строк')} (${res.skipped.slice(0, 3).map(x => x.row + ' — ' + x.why).join('; ')}${res.skipped.length > 3 ? '…' : ''}).` : '');

  /** Разобрать файлы и (после подтверждения) добавить. msg — id строки для сообщений. */
  async function importFiles(files, msg, opts = {}) {
    if (!window.FD_PAGE) { say(msg, 'Отчёт ещё загружается — повторите через пару секунд.'); return { texts: [] }; }
    let res = { it: [], rcp: [], skipped: [], sheets: [] }; const texts = [];
    for (const f of files) {
      try {
        const r = await T.fromFile(f, XL, opts);
        res = { it: res.it.concat(r.it), rcp: res.rcp.concat(r.rcp), skipped: res.skipped.concat(r.skipped), sheets: res.sheets.concat(r.sheets) };
        if (r.text != null && !r.sheets.length) texts.push({ f, text: r.text });
      } catch (e) {
        say(msg, `Не удалось прочитать «${f.name}»: ${e.message === 'xlsx' ? 'не загрузилась библиотека Excel' : e.message}.`);
        return { texts: [] };
      }
    }
    if (!res.it.length && !res.rcp.length) {
      if (!texts.length) say(msg, 'В файле не найдено строк квитанций или чеков. Нужны столбцы с названием и суммой, а также период (для ЖКХ) или дата (для чеков).' + skippedNote(res));
      return { texts };
    }
    const what = summary(res);
    const ask = PG().askConfirm;
    const okGo = typeof ask === 'function' ? await ask(`Импортировать из файла — ${what}?${skippedNote(res)} Совпадающие записи пропустятся, текущие данные не удаляются.`) : true;
    if (!okGo) { say(msg, 'Импорт отменён.'); return { texts }; }
    const r = apply(res);
    const out = [];
    if (res.it.length) out.push(`квитанции: +${r.ai}${r.ad ? `, уже были ${r.ad}` : ''}`);
    if (res.rcp.length) out.push(`чеки: +${r.ri}${r.rd ? `, уже были ${r.rd}` : ''}`);
    say(msg, 'Импортировано — ' + out.join('; ') + '.' + skippedNote(res));
    return { texts, added: r };
  }

  /** Текст без таблицы — это, скорее всего, сам чек: отдаём его разбору ИИ на листе «Продукты». */
  function toReceiptText(text, msg) {
    const t = $('txt'); if (!t) return;
    t.value = text.trim(); t.dispatchEvent(new Event('input', { bubbles: true }));
    const tab = document.querySelector('.tabs [data-s="sheet6"]'); if (tab) tab.click();
    setTimeout(() => t.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
    say(msg, 'Таблицы в файле нет — текст перенесён в поле чека на листе «Продукты». Нажмите «Разобрать».');
    say('xm3', 'Текст из файла вставлен ниже — нажмите «Разобрать».');
  }

  const isJson = f => /\.json$/i.test(f.name) || f.type === 'application/json';

  /* ---------- 1. «Данные → Импорт из файла» ---------- */
  const imp = $('imp');
  if (imp) {
    imp.setAttribute('accept', 'application/json,.json,' + TABLES);
    const hint = imp.parentNode.querySelector('.fb span'); if (hint) hint.textContent = 'JSON, CSV, TXT или XLSX';
    const lab = imp.closest('label'); if (lab) lab.setAttribute('title', 'JSON — резервная копия дайджеста; CSV, TXT, XLSX — таблицы квитанций ЖКХ или чеков');
  }
  // перехват в фазе погружения: JSON уходит старому обработчику, таблицы — сюда
  document.addEventListener('change', async e => {
    const el = e.target;
    if (el.id === 'imp') {
      const f = el.files && el.files[0];
      if (!f || isJson(f)) return;
      e.stopImmediatePropagation();
      say('xm', 'Читаю ' + f.name + '…');
      const r = await importFiles([f], 'xm');
      if (r.texts.length) toReceiptText(r.texts[0].text, 'xm');
      el.value = '';
    } else if (el.id === 'fd-bimp') {
      const fs = [...el.files]; if (!fs.length) return;
      say('xm2', 'Читаю…');
      const r = await importFiles(fs, 'xm2', { kind: 'it' });
      if (r.texts.length) say('xm2', 'В файле нет таблицы квитанций: нужны столбцы «Период», «Услуга», «Сумма» (можно «Тип», «Количество», «Тариф»).');
      el.value = '';
    } else if (el.id === 'sf') {
      if (route([...el.files], e)) el.value = ''; // только фото/PDF — как раньше
    }
  }, true);

  /* ---------- 2. ЖКХ: кнопка «Таблица квитанций» в архиве ---------- */
  const rf = $('rf');
  if (rf) {
    const lab = document.createElement('label'); lab.className = 'fp';
    lab.innerHTML = `Таблица квитанций<input id="fd-bimp" type="file" accept="${TABLES}" multiple><span class="fb"><b>CSV, TXT, XLSX</b><span>период, услуга, сумма</span></span>`;
    lab.title = 'Строки квитанций из таблицы: Период, Тип (УК, ЭСК, ЕРЦ ВС), Услуга, Количество, Тариф, Сумма. Подойдёт и файл, выгруженный из «Данных».';
    rf.closest('label').after(lab);
  }

  /* ---------- 3. «Продукты»: таблицы в зоне перетаскивания ---------- */
  const sf = $('sf');
  if (sf) sf.setAttribute('accept', (sf.getAttribute('accept') || '') + ',' + TABLES);
  const pend = $('pend');
  if (pend && /разбирает ИИ/.test(pend.textContent)) pend.textContent += ' Таблицы CSV и XLSX с позициями импортируются сразу.';
  /** Какие файлы — таблицы. TXT считается таблицей, только если в нём нашлись заголовки (иначе это текст чека для ИИ). */
  async function pickTables(fs) {
    const out = [];
    for (const f of fs) {
      if (T.isSheet(f.name) || /\.(csv|tsv)$/i.test(f.name)) out.push(f);
      else if (/\.txt$/i.test(f.name)) { try { const r = T.fromText(T.decode(await f.arrayBuffer())); if (r.sheets.length) out.push(f); } catch (_) { /* не таблица */ } }
    }
    return out;
  }
  async function receiptTables(tables, rest) {
    const store = ($('rstore') || {}).value || '', date = ($('rdate') || {}).value || '';
    await importFiles(tables, 'xm3', { kind: 'rcp', store, date });
    if (rest.length && PG().addFiles) PG().addFiles(rest);
  }
  /** Решение принимается синхронно (иначе старый обработчик успеет забрать файлы): CSV/TSV/XLSX и TXT перехватываются,
      дальше TXT без таблицы возвращается в очередь ИИ как текст чека. */
  function route(fs, ev) {
    const sure = fs.filter(f => T.isSheet(f.name) || /\.(csv|tsv)$/i.test(f.name));
    const txt = fs.filter(f => /\.txt$/i.test(f.name));
    if (!sure.length && !txt.length) return false;
    ev.stopImmediatePropagation();
    (async () => {
      const tables = sure.concat(await pickTables(txt));
      const rest = fs.filter(f => !tables.includes(f));
      if (tables.length) await receiptTables(tables, rest);
      else if (rest.length && PG().addFiles) PG().addFiles(rest);
    })();
    return true;
  }
  document.addEventListener('drop', e => {
    const dz = $('dz'); if (!dz || !dz.contains(e.target)) return;
    if (route([...((e.dataTransfer && e.dataTransfer.files) || [])], e)) { e.preventDefault(); dz.classList.remove('ov'); }
  }, true);

  window.FDImport = { importFiles, apply };
})();
