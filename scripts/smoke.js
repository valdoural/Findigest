'use strict';
/**
 * Дымовой тест: запускает приложение с временной папкой данных, открывает мастер и отчёт,
 * собирает ошибки консоли и делает скриншоты.
 * Запуск (Linux): xvfb-run -a npx electron scripts/smoke.js <папка-для-скриншотов>
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const OUT = process.argv[process.argv.length - 1].startsWith('/') ? process.argv[process.argv.length - 1] : path.join(os.tmpdir(), 'fd-smoke');
fs.mkdirSync(OUT, { recursive: true });
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-data-'));
app.setPath('userData', DATA);
app.commandLine.appendSwitch('no-sandbox');

const errors = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
app.on('browser-window-created', (_e, w) => {
  w.webContents.on('console-message', (e) => { const lvl = e.level ?? e; if (lvl === 'error' || lvl === 3 || lvl === 'warning' || lvl === 2) errors.push(`[${lvl}] ${e.message || ''}`); });
  w.webContents.on('preload-error', (_e, p, err) => errors.push('preload ' + err));
});

// подменяем app.setName из main.js, чтобы не трогать настоящий профиль
const origSetName = app.setName.bind(app);
app.setName = n => { origSetName(n); app.setPath('userData', DATA); };
require('../src/main/main.js');

app.whenReady().then(async () => {
  await wait(1500);
  if (process.env.FD_FIXTURE) { // данные Zenmoney из выгрузки, как после синхронизации
    const zen = require('../src/main/connectors/zenmoney');
    const t0 = Date.now(); const n = zen.apply(require('../test/mcp-to-diff')(process.env.FD_FIXTURE));
    require('../src/main/config/settings').patch('zenmoney', { enabled: true, lastSync: new Date().toISOString() });
    console.log('fixture applied', n, Date.now() - t0, 'ms');
  }
  await wait(1000);
  const w = BrowserWindow.getAllWindows()[0];
  w.setSize(1320, 900);
  const shot = async name => { const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG()); };
  await shot('01-wizard-welcome');
  for (const [i, n] of [[1, '02-wizard-db'], [2, '03-wizard-ai'], [3, '04-wizard-zen'], [4, '05-wizard-mail'], [5, '06-wizard-done']]) {
    await w.webContents.executeJavaScript(`document.querySelector('.pane.on [data-next],.pane.on [data-skip]').click()`);
    await wait(700); await shot(n);
  }
  await w.webContents.executeJavaScript(`document.getElementById('finish').click()`);
  await wait(5000);
  await shot('10-digest-sheet1');
  const live = await w.webContents.executeJavaScript(`({free:document.getElementById('free').textContent, sub:document.querySelector('#sheet1 .sub').textContent, cum:document.querySelector('[data-fd=cumTitle]').textContent, kp:document.getElementById('kp').innerText.slice(0,300), sigs:document.getElementById('sigs').innerText.slice(0,600), acl:(document.getElementById('acl')||{}).innerText})`);
  const info = await w.webContents.executeJavaScript(`({title:document.title, sheets:document.querySelectorAll('section.sheet').length, cnb:!!document.getElementById('cnb'), mail:document.body.innerHTML.includes('Привязка почты'), fonts:[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family+' '+f.weight).join(', '), bodyW:document.body.scrollWidth})`);
  // открываем «Подключения»
  await w.webContents.executeJavaScript(`document.getElementById('cnb').click()`); await wait(900); await shot('11-connections-ai');
  for (const [t, n] of [['zen', '12-connections-zen'], ['mail', '13-connections-mail'], ['upd', '15-connections-upd'], ['sys', '14-connections-sys']]) {
    await w.webContents.executeJavaScript(`document.querySelector('#cnp [data-t="${t}"]').click()`); await wait(400); await shot(n);
  }
  await w.webContents.executeJavaScript(`document.getElementById('cnx').click()`);
  for (let s = 2; s <= 6; s++) { await w.webContents.executeJavaScript(`document.querySelector('.tabs [data-s="sheet${s}"]').click()`); await wait(900); await shot(`2${s}-sheet${s}`); }
  // проверка БД: пишем и читаем документ через мост
  const dbt = await w.webContents.executeJavaScript(`(async()=>{const db=await window.claude.use('db');const c=db.collection('data/users/local');await c.doc('smoke').set({v:[1,2,3],t:1});const g=await c.doc('smoke').get();await c.doc('arc_x1').set({v:{id:'x1',kind:'receipt',status:'new',img:'data:image/png;base64,iVBORw0KGgo='}});const a=await c.doc('arc_x1').get();return {doc:g.data(),arcImg:!!a.data().v.img}})()`);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ live, info, dbt, errors, data: DATA, files: fs.readdirSync(DATA, { recursive: true }) }, null, 2));
  console.log(JSON.stringify({ live, info, dbt, errors: errors.slice(0, 30) }, null, 2));
  app.exit(0);
});
