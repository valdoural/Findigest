'use strict';
/**
 * Импорт квитанций и чеков из CSV / TXT / XLSX.
 *   1) разбор: выгрузки самого дайджеста, CSV из русского Excel (Windows-1251), «Текст Юникод» (UTF-16), XLSX с датами,
 *      произвольные заголовки, текст чека без таблицы;
 *   2) окно: «Данные → Импорт», кнопка в архиве ЖКХ, зона чеков на «Питании»; записи попали в отчёт и в базу, повтор не дублирует.
 * xvfb-run -a electron --no-sandbox test/import-test.js <папка для файлов>
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path');
const iconv = require('iconv-lite'); const XLSX = require('xlsx');
const T = require('../src/renderer/desktop/table-import.js');
const OUT = process.argv[process.argv.length - 1];
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-imp-')); app.setPath('userData', DATA);
app.commandLine.appendSwitch('no-sandbox'); app.on('window-all-closed', () => {});
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- файлы ---------- */
fs.mkdirSync(OUT, { recursive: true });
const F = {};
// выгрузка дайджеста (тот же формат, что «Данные → в файл»)
F.billsCsv = '﻿Период;Тип;Услуга;Количество;Тариф, ₽;Сумма, ₽\r\n2026-05;УК;Содержание жилья;50;30.88;1544\r\n2026-05;ЭСК;Электроэнергия;\"150,5\";4.5;677.25\r\n2026-05;ЕРЦ ВС;Холодная вода;4;55.1;220.4\r\n';
F.rcpTxt = '﻿Дата\tМагазин\tТовар\tГруппа\tСумма, ₽\r\n2026-10-01\tМагнит\tМолоко 3,2%\tМолочные продукты\t89.9\r\n2026-10-01\tМагнит\tЯблоки\tОвощи и фрукты\t154.3\r\n';
// CSV из русского Excel: Windows-1251, «;», запятая в дробях, даты ДД.ММ.ГГГГ, строка «Итого»
const excelCsv = 'Отчёт о покупках\r\n\r\nДата;Продавец;Наименование товара;Кол-во;Цена;Стоимость\r\n05.10.2026;Пятёрочка;Сыр 200 г;2;199,90;399,80\r\n05.10.2026;Пятёрочка;Пакет;1;5;5\r\nИтого;;;;;404,80\r\n';
const xlsxBuf = () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Квитанция за сентябрь'], [], ['Период', 'Поставщик', 'Услуга', 'Объём', 'Тариф', 'Начислено'],
    [new Date(2026, 5, 1), 'УК «Дом»', 'Содержание жилья', 50, 30.88, 1544], [new Date(2026, 5, 1), 'ЕРЦ', 'Водоотведение', 7, 40.2, 281.4], ['Итого', '', '', '', '', 1825.4]]), 'ЖКХ');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Дата', 'Магазин', 'Товар', 'Сумма'], [new Date(2026, 9, 7), 'Лента', 'Кофе', 499], [new Date(2026, 9, 7), 'Лента', 'Хлеб', 59.99]]), 'Чеки');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};
const files = {
  'kvitancii.csv': Buffer.from(F.billsCsv, 'utf8'),
  'cheki.txt': Buffer.from(F.rcpTxt, 'utf8'),
  'excel-1251.csv': iconv.encode(excelCsv, 'win1251'),
  'unicode.txt': Buffer.concat([Buffer.from([0xFF, 0xFE]), iconv.encode(F.rcpTxt.replace('﻿', '').replace(/2026-10-01/g, '02.10.2026').replace('Магнит', 'Магнум'), 'utf16le')]),
  'kniga.xlsx': xlsxBuf(),
  'chek.txt': Buffer.from('КАССОВЫЙ ЧЕК\nООО «Ромашка»\nМолоко 1 x 89.90 = 89.90\nИТОГ =89.90\n', 'utf8'),
};
for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(OUT, n), b);

/* ---------- 1. разбор ---------- */
const parse = (name, opts) => (T.isSheet(name) ? T.fromWorkbook(XLSX, files[name], opts) : T.fromText(T.decode(files[name]), opts));
{
  const b = parse('kvitancii.csv');
  ok(b.it.length === 3 && b.it[1].q === 150.5 && b.it[1].t === 'ЭСК' && b.it[2].t === 'ЕРЦ ВС', 'выгрузка квитанций CSV: 3 строки, «150,5» и типы распознаны');
  const r = parse('cheki.txt');
  ok(r.rcp.length === 2 && r.rcp[0].g === 'Молочные продукты' && r.rcp[0].n === 'Молоко 3,2%', 'выгрузка чеков TXT (табуляция): 2 позиции с группами');
  const e = parse('excel-1251.csv');
  ok(e.rcp.length === 2 && e.rcp[0].s === 399.8 && e.rcp[0].d === '2026-10-05' && e.rcp[0].st === 'Пятёрочка' && !e.skipped.length, 'CSV Excel в Windows-1251: кодировка, «399,80», дата ДД.ММ.ГГГГ, «Итого» пропущено');
  const u = parse('unicode.txt');
  ok(u.rcp.length === 2 && u.rcp[0].st === 'Магнум' && u.rcp[0].d === '2026-10-02', 'TXT «Текст Юникод» (UTF-16)');
  const x = parse('kniga.xlsx');
  ok(x.it.length === 2 && x.it[0].p === '2026-06' && x.it[1].t === 'ЕРЦ ВС' && x.rcp.length === 2 && x.rcp[0].d === '2026-10-07', 'XLSX: два листа — квитанции (дата-ячейка → период) и чеки');
  const c = parse('chek.txt');
  ok(!c.sheets.length && /КАССОВЫЙ/.test(c.text), 'текст чека без таблицы — уходит разбору ИИ');
  const amb = T.fromText('Наименование;Цена;Количество;Сумма\nВода;10;2;20\n', { kind: 'rcp', date: '2026-10-10', store: 'Лента' });
  ok(amb.rcp.length === 1 && amb.rcp[0].st === 'Лента', 'неоднозначная таблица в зоне чеков считается чеком, дата и магазин — из формы');
}

/* ---------- 2. окно ---------- */
app.whenReady().then(async () => {
  try {
    require('../src/main/paths').P.ensure();
    const S = require('../src/main/config/settings'); S.load(); await require('../src/main/config/secrets').load();
    const D = require('../src/main/db/database'); D.open();
    S.patch('firstRunDone', true); require('../src/main/ipc').register({});
    const w = new BrowserWindow({ show: true, width: 1320, height: 900, webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload', 'preload.js'), contextIsolation: true, sandbox: true } });
    const errors = []; w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message + ' @' + (e.sourceId || '').split('/').pop() + ':' + e.lineNumber); });
    await w.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'digest', 'index.html'));
    await sleep(3000);
    const js = s => w.webContents.executeJavaScript(s);
    // подтверждение отвечаем «да» и запоминаем текст
    await js(`window.__asked=[];FD_PAGE.askConfirm=async m=>{window.__asked.push(m);return true};0`);
    const put = (id, names) => js(`(()=>{const dt=new DataTransfer();${names.map(n => `dt.items.add(new File([Uint8Array.from(atob('${files[n].toString('base64')}'),c=>c.charCodeAt(0))],'${n}'));`).join('')}const el=document.getElementById('${id}');el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    const st = () => js(`({it:FD_PAGE.IT.length,rcp:FD_PAGE.RCP.length,xm:document.getElementById('xm').textContent,xm2:document.getElementById('xm2').textContent,xm3:document.getElementById('xm3').textContent})`);
    const ui = await js(`({acc:document.getElementById('imp').accept,hint:document.querySelector('#imp + .fb span').textContent,b:!!document.getElementById('fd-bimp'),sf:document.getElementById('sf').accept})`);
    ok(/\.csv/.test(ui.acc) && /\.xlsx/.test(ui.acc) && /\.json/.test(ui.acc) && /XLSX/.test(ui.hint), '«Данные → Импорт»: принимает JSON, CSV, TXT, XLSX — ' + ui.hint);
    ok(ui.b && /\.xlsx/.test(ui.sf), 'кнопка «Таблица квитанций» в архиве ЖКХ, зона чеков принимает таблицы');
    const s0 = await st();
    await put('imp', ['kniga.xlsx']); await sleep(1200);
    let s1 = await st();
    ok(s1.it === s0.it + 2 && s1.rcp === s0.rcp + 2, `«Данные»: XLSX → квитанции +${s1.it - s0.it}, чеки +${s1.rcp - s0.rcp}: ${s1.xm}`);
    ok(await js(`/квитанции ЖКХ: 2 строки, период 2026-06.*чеки: 2 позиции/.test(window.__asked[0])`), 'перед импортом показано, что найдено');
    await put('imp', ['kniga.xlsx']); await sleep(1000);
    let s2 = await st();
    ok(s2.it === s1.it && s2.rcp === s1.rcp && /уже были 2/.test(s2.xm), 'повторный импорт не дублирует: ' + s2.xm);
    await put('fd-bimp', ['kvitancii.csv']); await sleep(1000);
    s2 = await st();
    ok(s2.it === s1.it + 3, 'ЖКХ → «Таблица квитанций»: CSV +3 — ' + s2.xm2);
    await js(`document.querySelector('.tabs [data-s="sheet6"]').click()`); await sleep(300);
    await put('sf', ['excel-1251.csv', 'chek.txt']); await sleep(1500);
    const s3 = await st();
    const pend = await js(`document.getElementById('pend').textContent`);
    ok(s3.rcp === s2.rcp + 2, '«Питание»: CSV из Excel импортирован сразу — ' + s3.xm3);
    ok(/chek\.txt/.test(pend), 'текст чека из того же выбора ушёл в очередь ИИ: ' + pend);
    // JSON по-прежнему работает старым путём
    await put('imp', []); // пустой выбор игнорируется
    const json = Buffer.from(JSON.stringify({ it: [{ p: '2026-07', t: 'УК', n: 'Домофон', q: 0, r: 0, s: 50 }] }));
    files['backup.json'] = json; await put('imp', ['backup.json']); await sleep(800);
    const s4 = await st();
    ok(s4.it === s3.it + 1 && /Импортировано: позиции ЖКХ/.test(s4.xm), 'JSON-копия импортируется как раньше');
    // в отдельной базе
    await sleep(1500);
    const db = { bills: D.db.prepare("SELECT COUNT(*) n FROM bill_items WHERE period IN ('2026-05','2026-06')").get().n, rcp: D.db.prepare("SELECT COUNT(*) n FROM receipt_items WHERE date >= '2026-10-05'").get().n };
    ok(db.bills === 5 && db.rcp === 4, `в базе: строки квитанций ${db.bills}, позиции чеков ${db.rcp}`);
    fs.writeFileSync(path.join(OUT, 'import-pitanie.png'), (await w.webContents.capturePage()).toPNG());
    await js(`document.querySelector('.tabs [data-s="sheet5"]').click()`); await sleep(400);
    await js(`document.getElementById('fd-bimp').scrollIntoView({block:'center'})`); await sleep(300);
    fs.writeFileSync(path.join(OUT, 'import-zhkh.png'), (await w.webContents.capturePage()).toPNG());
    w.setContentSize(420, 860); await sleep(500);
    ok(await js(`document.documentElement.scrollWidth<=innerWidth+1`), '420px: без горизонтальной прокрутки');
    fs.writeFileSync(path.join(OUT, 'import-zhkh-420.png'), (await w.webContents.capturePage()).toPNG());
    ok(!errors.length, 'ошибок нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  } catch (e) { console.error(e); process.exitCode = 1; }
  app.exit(process.exitCode || 0);
});
