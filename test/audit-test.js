'use strict';
/**
 * Исправления по аудиту (Emil Kowalski: break-ui, review-animations) на «худших реалистичных данных»:
 * логотип на узком окне, проценты-гиганты → кратность, перевыполненная цель, подсказка у цели, пауза подсказки при наведении,
 * помощник с клавиатуры — без анимации. xvfb-run -a electron --no-sandbox test/audit-test.js <папка> <выгрузка-худший-случай>
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const [OUT, FIX] = process.argv.slice(-2);
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'fd-au-')));
app.commandLine.appendSwitch('no-sandbox'); app.on('window-all-closed', () => {});
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    require('../src/main/paths').P.ensure();
    const S = require('../src/main/config/settings'); S.load(); await require('../src/main/config/secrets').load();
    require('../src/main/db/database').open();
    require('../src/main/connectors/zenmoney').apply(require('./mcp-to-diff')(FIX));
    S.patch('zenmoney', { enabled: true, lastSync: new Date().toISOString() }); S.patch('firstRunDone', true);
    require('../src/main/ipc').register({});
    const w = new BrowserWindow({ show: true, width: 1440, height: 900, webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload', 'preload.js'), contextIsolation: true, sandbox: true } });
    const errors = []; w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message); });
    await w.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'digest', 'index.html')); await sleep(3500);
    const js = s => w.webContents.executeJavaScript(s);
    const text = sel => js(`(document.querySelector(${JSON.stringify(sel)})||{}).textContent||''`);

    const cats = await text('#cats');
    ok(!/\d{4,}[,.]\d%/.test(cats) && /в \d+ раз(а)? больше к сравн/.test(cats), 'рост категории в сотни процентов — кратностью: ' + (cats.match(/в \d+ раз(а)? больше к сравн\./) || [''])[0]);
    const kp = await js(`[...document.querySelectorAll('#sheet1 .kp')].map(x=>x.textContent).join(' | ')`);
    ok(/больше прогноза за месяц/.test(kp) && !/от прогноза \d{4,}%/.test(kp), 'расходы далеко выше прогноза — «в N раз больше прогноза»');
    ok(/достигнута — отметить/.test(await text('#sheet1')), 'цель достигнута по цифрам — у переключателя «достигнута — отметить»');
    await js(`document.querySelector('.tabs [data-s="sheet4"]').click()`); await sleep(400);
    ok(/цель достигнута \(в \d+ раз(а)? больше\)/.test(await text('#sheet4')), 'пассивный доход сверх цели — «цель достигнута (в N раз больше)», без «2036%»');

    w.setContentSize(400, 860); await sleep(700);
    const logo = await js(`Math.round(document.querySelector('.top .logo svg').getBoundingClientRect().width)`);
    ok(logo >= 30, `логотип на окне 400 px не сжимается: ${logo} px`);
    fs.writeFileSync(path.join(OUT, 'header-400.png'), (await w.webContents.capturePage()).toPNG());
    w.setContentSize(1440, 900); await sleep(500);

    // подсказка не исчезает, пока на неё наведён курсор
    await js(`window.FD_toast('Проверка паузы подсказки')`); await sleep(200);
    const r = await js(`(()=>{const b=document.querySelector('.fd-toast').getBoundingClientRect();return {x:Math.round(b.left+20),y:Math.round(b.top+b.height/2)}})()`);
    w.webContents.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y }); await sleep(7600);
    ok(await js(`!document.querySelector('.fd-toast').hidden`), 'подсказка не исчезает, пока на неё наведён курсор (7,6 с)');
    w.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 400 }); await sleep(7300); // после ухода курсора отсчёт продолжается с оставшегося времени
    ok(await js(`document.querySelector('.fd-toast').hidden`), 'после ухода курсора подсказка скрывается, когда истечёт оставшееся время');

    // помощник с клавиатуры — без анимации
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space', modifiers: ['control', 'shift'] }); await sleep(30);
    const inst = await js(`(()=>{const p=document.getElementById('asp');return !p.hidden&&getComputedStyle(p).opacity==='1'})()`);
    ok(inst, 'Ctrl+Shift+Пробел открывает помощника сразу, без проявления');
    ok(!errors.length, 'ошибок нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  } catch (e) { console.error(e); process.exitCode = 1; }
  app.exit(process.exitCode || 0);
});
