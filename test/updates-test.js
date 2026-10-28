'use strict';
/**
 * Обновления из GitHub Releases на локальной подмене API: список версий, предварительные версии, скачивание с проверкой sha512,
 * повреждённый файл, ошибки; вкладка «О программе» (создатель, версии) и масштаб графика «Стоимость».
 * xvfb-run -a -s "-screen 0 1600x1000x24" electron --no-sandbox test/updates-test.js <папка> <выгрузка Zenmoney>
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http'); const crypto = require('crypto');
const OUT = process.argv[process.argv.length - 2]; const FIX = process.argv[process.argv.length - 1];
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'fd-upd-')));
app.commandLine.appendSwitch('no-sandbox'); app.on('window-all-closed', () => {});
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CUR = require('../package.json').version;
const bump = (v, k) => { const p = v.split('.').map(Number); p[k]++; for (let i = k + 1; i < 3; i++) p[i] = 0; return p.join('.'); };
const NEXT = bump(CUR, 2), PRE = bump(CUR, 0) + '-beta.1';

const EXE = crypto.randomBytes(300000); const SHA = crypto.createHash('sha512').update(EXE).digest('base64');
let badSha = false, hits = [];
const srv = http.createServer((req, res) => {
  hits.push(req.url);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const asset = (v, name, size) => ({ id: name.length, name, size, url: `${base}/api-asset/${name}`, browser_download_url: `${base}/dl/${name}` });
  const rel = (v, pre, date) => ({ tag_name: 'v' + v, name: 'Версия ' + v, draft: false, prerelease: pre, published_at: date, html_url: `https://github.com/o/r/releases/tag/v${v}`, body: '— исправления\n— новое',
    assets: [asset(v, `FinDigest-Setup-${v}.exe`, EXE.length), asset(v, 'latest.yml', 100), asset(v, `FinDigest-src-${v}.zip`, 10)], zipball_url: 'x' });
  if (req.url.startsWith('/repos/o/r/releases')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify([rel(PRE, true, '2026-11-02T10:00:00Z'), rel(NEXT, false, '2026-10-30T10:00:00Z'), rel(CUR, false, '2026-10-27T10:00:00Z'), { ...rel('9.9.9', false, ''), draft: true }])); }
  if (req.url.startsWith('/repos/')) { res.statusCode = 404; return res.end('{"message":"Not Found"}'); }
  if (req.url.endsWith('latest.yml')) return res.end(`version: ${NEXT}\nfiles:\n  - url: FinDigest-Setup-${NEXT}.exe\n    sha512: ${badSha ? 'AAAA' : SHA}\npath: FinDigest-Setup-${NEXT}.exe\nsha512: ${badSha ? 'AAAA' : SHA}\n`);
  if (req.url.endsWith('.exe')) { res.setHeader('content-length', EXE.length); return res.end(EXE); }
  res.statusCode = 404; res.end();
});

app.whenReady().then(async () => {
  try {
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    process.env.FD_GH_API = `http://127.0.0.1:${srv.address().port}`;
    fs.mkdirSync(OUT, { recursive: true });
    require('../src/main/paths').P.ensure();
    const S = require('../src/main/config/settings'); S.load(); await require('../src/main/config/secrets').load();
    require('../src/main/db/database').open();
    require('../src/main/connectors/zenmoney').apply(require('./mcp-to-diff')(FIX));
    S.patch('zenmoney', { enabled: true, lastSync: new Date().toISOString() }); S.patch('firstRunDone', true);
    require('../src/main/ipc').register({});
    const U = require('../src/main/updates');

    ok(U.cmp('1.0.0', '0.9.9') > 0 && U.cmp('1.0.0-beta.1', '1.0.0') < 0 && U.cmp('v0.9.1', '0.9.1') === 0, 'сравнение версий (в т.ч. pre-release и префикс v)');
    let st = U.status(); const PKGR = require('../package.json').fdRelease || {}; ok(st.configured && st.owner === PKGR.owner && st.repo === PKGR.repo, `из коробки — репозиторий из package.json: ${st.owner}/${st.repo}`);
    st = U.set({ owner: 'https://github.com/o/r' }); ok(st.owner === 'o' && st.repo === 'r', 'ссылка на репозиторий разбирается в владельца и название');
    st = await U.check();
    ok(st.newer && st.latest.version === NEXT && st.releases.length === 2, `есть новая версия ${NEXT} (черновики и pre-release не предлагаются), всего ${st.releases.length}`);
    ok(st.latestPage === 'https://github.com/o/r/releases/latest' && st.latest.exe && st.latest.src.name.includes('src'), 'ссылки: последняя версия, установщик, исходники');
    U.set({ prerelease: true }); st = await U.check(); ok(st.latest.version === PRE, 'с «предварительными версиями» — предлагается ' + PRE);
    U.set({ prerelease: false }); st = await U.check();
    const got = await U.fetchInstaller(NEXT);
    ok(fs.existsSync(got.file) && fs.statSync(got.file).size === EXE.length && got.verified, 'установщик скачан, sha512 из latest.yml совпал');
    badSha = true; let e1 = null; try { await U.fetchInstaller(NEXT); } catch (e) { e1 = e; }
    ok(e1 && e1.code === 'corrupt' && !fs.existsSync(got.file), 'повреждённый файл: установка отменена, файл удалён — ' + (e1 && e1.message));
    badSha = false;
    U.set({ owner: 'o', repo: 'missing' }); let e2 = null; try { await U.check(); } catch (e) { e2 = e; }
    ok(e2 && e2.code === 'not_found' && /токен/.test(e2.message), 'нет репозитория — понятная ошибка: ' + (e2 && e2.message));
    U.set({ owner: 'o', repo: 'r' });

    /* окно: «О программе» и график «Стоимость» */
    const w = new BrowserWindow({ show: true, width: 1440, height: 900, webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload', 'preload.js'), contextIsolation: true, sandbox: true } });
    w.setContentSize(1440, 900);
    const errors = []; w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message); });
    await w.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'digest', 'index.html')); await sleep(3000);
    const js = s => w.webContents.executeJavaScript(s);
    const shot = n => w.webContents.capturePage().then(i => fs.writeFileSync(path.join(OUT, n + '.png'), i.toPNG()));

    const daysW = await js(`document.getElementById('days').getBoundingClientRect().width`);
    await js(`document.querySelector('.tabs [data-s="sheet3"]').click()`); await sleep(400);
    const vs = await js(`(()=>{const r=document.getElementById('vs').getBoundingClientRect(),a=document.getElementById('varch').getBoundingClientRect();return {w:r.width,h:r.height,side:Math.abs(a.top-document.getElementById('vcard').getBoundingClientRect().top)<2&&a.left>r.right}})()`);
    ok(Math.abs(vs.w - daysW) < 4, `«Стоимость: история и оценки» — график того же масштаба, что «Расходы нарастающим итогом» (${Math.round(vs.w)}×${Math.round(vs.h)} и ${Math.round(daysW)} px)`);
    ok(vs.side, 'архив оценок — рядом справа');
    await js(`document.getElementById('vs').scrollIntoView({block:'center'})`); await sleep(300); await shot('value-chart');

    await js(`document.getElementById('fdMore') ? document.getElementById('fdMore').click() : 0`); await sleep(300);
    const menuItem = await js(`[...document.querySelectorAll('.fd-menu button')].some(b=>/О программе/.test(b.textContent))`);
    await js(`document.querySelector('.fd-menu') && (document.querySelector('.fd-menu').hidden=true)`);
    await js(`window.FD_openAbout()`); await sleep(1500);
    const ab = await js(`(()=>{const s=document.querySelector('#cnp [data-sec="about"]');return {on:s.classList.contains('on'),author:/Создатель — Vlad Nikolaev/.test(s.textContent),ver:s.textContent.includes('${CUR}'),newer:!!s.querySelector('.ab-new [data-inst="${NEXT}"]'),rows:s.querySelectorAll('.ab-list li').length,latest:!!s.querySelector('[data-url$="/releases/latest"]')}})()`);
    ok(ab.on && ab.author && ab.ver, '«О программе»: создатель и установленная версия');
    ok(ab.newer && ab.rows === 2 && ab.latest, `«Доступна версия ${NEXT}» с кнопкой установки, список версий (${ab.rows}), ссылка на последнюю`);
    ok(menuItem, 'пункт «О программе и обновления» в меню «⋯» (' + menuItem + ')');
    await shot('about');
    // подтверждение установки — своя кнопка «Установить», не красная «Удалить»
    await js(`document.querySelector('#cnp .ab-new [data-inst]').click()`); await sleep(300);
    const cf = await js(`({t:document.getElementById('cfY').textContent,shown:!document.getElementById('cf').hidden})`);
    ok(cf.shown && cf.t === 'Установить', 'перед установкой — подтверждение с кнопкой «Установить»');
    await js(`document.getElementById('cfN').click()`); await sleep(200);
    // уведомление о новой версии
    w.webContents.send('updates:available', { version: NEXT, current: CUR, url: '' }); await sleep(400);
    const toast = await js(`(()=>{const t=document.querySelector('.fd-toast');return t&&!t.hidden?t.textContent:''})()`);
    ok(/Доступна новая версия/.test(toast) && /Обновить/.test(toast), 'подсказка «Доступна новая версия» с кнопкой «Обновить»');
    ok(!errors.length, 'ошибок нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  } catch (e) { console.error(e); process.exitCode = 1; }
  srv.close(); app.exit(process.exitCode || 0);
});
