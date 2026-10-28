'use strict';
/**
 * Выводы ИИ по листам: генерация по данным Zenmoney (тестовый ИИ), показ на листах, «Разбор» вместо примера,
 * сохранение между запусками, ошибка не стирает прежние выводы, автообновление не чаще раза в 4 часа.
 * xvfb-run -a electron --no-sandbox test/insights-test.js <папка> <выгрузка Zenmoney>
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path');
const OUT = process.argv[process.argv.length - 2]; const FIX = process.argv[process.argv.length - 1];
process.env.FD_AI_MOCK = path.join(__dirname, 'fixtures', 'ai-mock.js');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-ins-')); app.setPath('userData', DATA);
app.commandLine.appendSwitch('no-sandbox'); app.on('window-all-closed', () => {});
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mock = require('./fixtures/ai-mock.js');

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    require('../src/main/paths').P.ensure();
    const S = require('../src/main/config/settings'); S.load(); await require('../src/main/config/secrets').load();
    require('../src/main/db/database').open();
    require('../src/main/connectors/zenmoney').apply(require('./mcp-to-diff')(FIX));
    S.patch('zenmoney', { enabled: true, lastSync: new Date().toISOString() }); S.patch('firstRunDone', true);
    require('../src/main/ipc').register({});
    const ins = require('../src/main/insights/insights');
    const snap = ins.snapshot();
    ok(snap.текущий_месяц && snap.капитал_история_тыс && snap.расходы_по_категориям_за_месяцы, 'сводка для ИИ: месяц, история капитала, категории по месяцам (' + Math.round(JSON.stringify(snap).length / 1024) + ' КБ)');
    ok(ins.clean({ sheet1: [{ tag: 'x', text: 'a', tone: 'bad' }, { text: '' }] }).sheet1.length === 1 && ins.clean({}).sheet3.length === 0, 'ответ ИИ проверяется: неизвестный тон → info, пустые выводы отброшены');

    const w = new BrowserWindow({ show: true, width: 1320, height: 900, webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload', 'preload.js'), contextIsolation: true, sandbox: true } });
    const errors = []; w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message + ' @' + (e.sourceId || '').split('/').pop() + ':' + e.lineNumber); });
    const page = path.join(__dirname, '..', 'src', 'renderer', 'digest', 'index.html');
    await w.loadFile(page); await sleep(3000);
    const js = s => w.webContents.executeJavaScript(s);
    const state = () => js(`(()=>{const r={};document.querySelectorAll('section.sheet').forEach(s=>{const c=s.querySelector('.fd-ai-card');r[s.id]=c?{shown:!c.hidden&&!c.closest('[hidden]'),items:c.querySelectorAll('.fd-ai-body .sig').length,btn:(c.querySelector('.fd-ai-btn span')||{}).textContent,when:(c.querySelector('.fd-ai-when')||{}).textContent,ex:[...c.children].some(e=>e.classList&&e.classList.contains('sig')&&!e.hidden&&!e.closest('.fd-ai-body')),err:(c.querySelector('.fd-ai-err')||{}).textContent||''}:null});return r})()`);
    let s0 = await state();
    ok(Object.values(s0).every(Boolean), 'карточка выводов есть на всех 6 листах');
    ok(s0.sheet1.shown && s0.sheet1.btn === 'Сформировать выводы' && !s0.sheet2.ex, 'до первых выводов: кнопка «Сформировать выводы», пример в «Разборе» скрыт' + (s0.sheet1.shown && s0.sheet1.btn === 'Сформировать выводы' && !s0.sheet2.ex ? '' : JSON.stringify([s0.sheet1, s0.sheet2])));
    await js(`document.querySelector('#sheet1 .fd-ai-btn').click()`); await sleep(1500);
    let s1 = await state();
    ok([1, 2, 3, 4, 5].every(i => s1['sheet' + i].items === 2), 'выводы на листах 1–5: по 2');
    ok(!s1.sheet6.shown, '«Питание»: выводов нет — карточка скрыта');
    ok(/тест · \d\d\.\d\d, \d\d:\d\d/.test(s1.sheet1.when) && s1.sheet1.btn === 'Обновить выводы', 'видно, кто и когда: ' + s1.sheet1.when);
    const html = await js(`document.querySelector('#sheet3 .fd-ai-body').innerHTML`);
    ok(/&lt;b&gt;без разметки/.test(html) && /sig fd-t-info/.test(html), 'текст ИИ экранируется, нейтральный тон оформлен');
    const t1 = await js(`document.querySelector('#sheet1 .fd-ai-body .sig').textContent`);
    ok(/\d+ ₽ при прогнозе \d+ ₽/.test(t1), 'вывод построен по данным: ' + t1);
    await js(`document.querySelector('.tabs [data-s="sheet2"]').click()`); await sleep(300);
    fs.writeFileSync(path.join(OUT, 'insights-sheet2.png'), (await w.webContents.capturePage()).toPNG());
    await js(`document.querySelector('.tabs [data-s="sheet1"]').click()`); await sleep(300);
    fs.writeFileSync(path.join(OUT, 'insights-sheet1.png'), (await w.webContents.capturePage()).toPNG());
    // ошибка: прежние выводы остаются, сообщение рядом
    mock.failInsights = true;
    await js(`document.querySelector('#sheet4 .fd-ai-btn').click()`); await sleep(1200);
    const s2 = await state();
    ok(s2.sheet4.items === 2 && /перегружен/.test(s2.sheet4.err), 'ошибка ИИ: прежние выводы на месте, причина показана — ' + s2.sheet4.err);
    mock.failInsights = false;
    // лимит «в минуту»: кнопка показывает отсчёт, затем повтор проходит
    mock.failInsights = '429once';
    await js(`document.querySelector('#sheet4 .fd-ai-btn').click()`); await sleep(900);
    const wait = await js(`document.querySelector('#sheet4 .fd-ai-btn span').textContent`);
    await sleep(2500);
    const s2b = await state();
    ok(/Лимит ИИ, повтор через \d с/.test(wait) && s2b.sheet4.items === 2 && !s2b.sheet4.err, 'лимит ИИ в минуту: «' + wait + '», затем повтор удался');
    // автообновление: только что обновляли — не запускается
    ok(ins.maybeAuto('test') === false, 'автообновление не чаще раза в 4 часа');
    // перезапуск окна — выводы из базы
    await w.loadFile(page); await sleep(3000);
    const s3 = await state();
    ok(s3.sheet2.items === 2 && !s3.sheet2.ex, 'после перезапуска выводы берутся из базы');
    w.setContentSize(420, 860); await sleep(500);
    ok(await js(`document.documentElement.scrollWidth<=innerWidth+1`), '420px: без горизонтальной прокрутки');
    fs.writeFileSync(path.join(OUT, 'insights-420.png'), (await w.webContents.capturePage()).toPNG());
    ok(!errors.length, 'ошибок нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  } catch (e) { console.error(e); process.exitCode = 1; }
  app.exit(process.exitCode || 0);
});
