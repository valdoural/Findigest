'use strict';
/**
 * Шапка на разных ширинах окна: логотип, вкладки и кнопки не пересекаются, вкладки не обрезаны,
 * нет горизонтальной прокрутки страницы. Скриншоты шапки — в папку из аргумента.
 * xvfb-run -a electron --no-sandbox test/layout-test.js <папка> [выгрузка Zenmoney]
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path');
const OUT = process.argv[process.argv.length - 2]; const FIX = process.argv[process.argv.length - 1];
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-lay-')); app.setPath('userData', DATA);
app.commandLine.appendSwitch('no-sandbox'); app.on('window-all-closed', () => {});
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const WIDTHS = [1600, 1320, 1100, 900, 700, 520, 420];

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  require('../src/main/paths').P.ensure();
  const S = require('../src/main/config/settings'); S.load(); await require('../src/main/config/secrets').load();
  require('../src/main/db/database').open();
  if (FIX && fs.existsSync(path.join(FIX, 'accounts.json'))) { require('../src/main/connectors/zenmoney').apply(require('./mcp-to-diff')(FIX)); S.patch('zenmoney', { enabled: true, lastSync: new Date().toISOString() }); }
  S.patch('firstRunDone', true); require('../src/main/ipc').register({});
  const w = new BrowserWindow({ show: true, width: 1600, height: 900, webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload', 'preload.js'), contextIsolation: true, sandbox: true } });
  const errors = []; w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message + ' @' + (e.sourceId || '').split('/').pop() + ':' + e.lineNumber); });
  await w.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'digest', 'index.html'));
  await new Promise(r => setTimeout(r, 3500));
  for (const W of WIDTHS) {
    w.setContentSize(W, 860); await new Promise(r => setTimeout(r, 450));
    for (const sheet of ['sheet1', 'sheet6']) {
      await w.webContents.executeJavaScript(`document.querySelector('.tabs [data-s="${sheet}"]').click()`); await new Promise(r => setTimeout(r, 250));
      const m = await w.webContents.executeJavaScript(`(()=>{const bar=document.querySelector('.top .in'),R=e=>e.getBoundingClientRect(),logo=R(bar.querySelector('.logo')),nav=bar.querySelector('.tabs'),nr=R(nav),act=R(bar.querySelector('.fd-actions'));
        const bottom=getComputedStyle(nav).position==='fixed';
        const tabs=[...nav.children].map(b=>R(b));if(bottom){const lr=logo;return {mode:'нижняя панель/'+bar.dataset.logo+'/'+bar.dataset.act,logoNav:lr.right<=act.left+0.5,navAct:true,clipped:tabs.filter(t=>t.left<nr.left-0.5||t.right>nr.right+0.5).length,overlap:tabs.some((t,i)=>i&&t.left<tabs[i-1].right-0.5),actRight:act.right<=innerWidth,hscroll:document.documentElement.scrollWidth>innerWidth+1}}const clipped=tabs.filter(t=>t.left<nr.left-0.5||t.right>nr.right+0.5).length;const overlap=tabs.some((t,i)=>i&&t.left<tabs[i-1].right-0.5);
        return {mode:bar.dataset.tabs+'/'+bar.dataset.logo+'/'+bar.dataset.act,logoNav:logo.right<=nr.left+0.5,navAct:nr.right<=act.left+0.5,clipped,overlap,actRight:act.right<=innerWidth,hscroll:document.documentElement.scrollWidth>innerWidth+1}})()`);
      const good = m.logoNav && m.navAct && !m.clipped && !m.overlap && m.actRight && !m.hscroll;
      ok(good, `${W}px, ${sheet === 'sheet1' ? 'Баланс' : 'Питание'}: режим ${m.mode}${good ? '' : ' ' + JSON.stringify(m)}`);
    }
    const img = await w.webContents.capturePage({ x: 0, y: 0, width: W, height: 86 });
    fs.writeFileSync(path.join(OUT, `hdr-${W}.png`), img.toPNG());
  }
  // меню «⋯» на узком окне
  w.setContentSize(420, 860); await new Promise(r => setTimeout(r, 400));
  const menu = await w.webContents.executeJavaScript(`(async()=>{document.getElementById('fdMore').click();await new Promise(r=>setTimeout(r,100));const m=document.querySelector('.fd-menu');return {open:!m.hidden,items:[...m.querySelectorAll('button')].map(b=>b.textContent)}})()`);
  ok(menu.open && menu.items.length === 4 && /О программе/.test(menu.items[3]), 'меню «⋯»: ' + menu.items.join(' · '));
  fs.writeFileSync(path.join(OUT, 'page-420.png'), (await w.webContents.capturePage()).toPNG());
  w.setContentSize(1320, 860); await new Promise(r => setTimeout(r, 400));
  fs.writeFileSync(path.join(OUT, 'page-1320.png'), (await w.webContents.capturePage()).toPNG());
  ok(!errors.length, 'ошибок нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  app.exit(process.exitCode || 0);
});
