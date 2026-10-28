'use strict';
/**
 * Логотипы банков и магазинов: загрузка (локальный сервер вместо сайтов), проверка картинки, кеш, буква — если логотипа нет,
 * подмена значков в «Распределении капитала» и в списке магазинов, выключатель в настройках.
 * xvfb-run -a electron --no-sandbox test/logos-test.js <папка> <выгрузка Zenmoney>
 */
const { app, BrowserWindow, nativeImage } = require('electron');
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
const OUT = process.argv[process.argv.length - 2]; const FIX = process.argv[process.argv.length - 1];
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'fd-logo-')));
app.commandLine.appendSwitch('no-sandbox'); app.on('window-all-closed', () => {});
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const png = (size, rgb) => { const b = Buffer.alloc(size * size * 4); for (let i = 0; i < b.length; i += 4) { b[i] = rgb[2]; b[i + 1] = rgb[1]; b[i + 2] = rgb[0]; b[i + 3] = 255; } return nativeImage.createFromBitmap(b, { width: size, height: size }).toPNG(); };

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const hits = [];
    const ICONS = { 'bank.yandex.ru': png(180, [252, 63, 29]), 'sberbank.ru': png(128, [33, 160, 56]), '5ka.ru': png(120, [220, 30, 40]), 'alfabank.ru': png(16, [239, 49, 36]) };
    const srv = http.createServer((req, res) => {
      const d = decodeURIComponent(req.url.split('/')[1]); hits.push(d);
      if (ICONS[d]) { res.writeHead(200, { 'content-type': 'image/png' }); res.end(ICONS[d]); } else { res.writeHead(404); res.end(); }
    }).listen(0);
    const port = srv.address().port;
    require('../src/main/paths').P.ensure();
    const S = require('../src/main/config/settings'); S.load(); await require('../src/main/config/secrets').load();
    const D = require('../src/main/db/database'); D.open();
    require('../src/main/connectors/zenmoney').apply(require('./mcp-to-diff')(FIX));
    S.patch('zenmoney', { enabled: true, lastSync: new Date().toISOString() }); S.patch('firstRunDone', true);
    const logos = require('../src/main/logos');
    logos._setSources([d => `http://127.0.0.1:${port}/${d}/icon`]);
    require('../src/main/ipc').register({});

    ok(logos.storeSite('Пятёрочка') === '5ka.ru' && logos.storeSite('ООО «Лента-12»') === 'lenta.com' && logos.storeSite('Магнум') === '', 'магазины сопоставляются с сайтами по названию (неизвестные — без сайта)');
    const r1 = await logos.get([{ name: 'Сбер', site: 'sberbank.ru' }, { name: 'Альфа', site: 'alfabank.ru' }, { name: 'Пятёрочка' }, { name: 'Неизвестно', site: 'nope.example' }]);
    ok(r1['Сбер'] && /^data:image\/png;base64,/.test(r1['Сбер']) && r1['Пятёрочка'], 'логотипы загружены и сохранены как картинки 64×64');
    ok(!r1['Альфа'] && !r1['Неизвестно'], 'значок 16×16 и отсутствующий сайт отбрасываются — останется буква');
    const n0 = hits.length; await logos.get([{ name: 'Сбер', site: 'sberbank.ru' }, { name: 'Неизвестно', site: 'nope.example' }]);
    ok(hits.length === n0, 'повторно из кеша, без запросов (и для ненайденных тоже)');
    ok(D.db.prepare('SELECT COUNT(*) n FROM logos').get().n === 4, 'кеш в базе: 4 домена');

    const w = new BrowserWindow({ show: true, width: 1320, height: 900, webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload', 'preload.js'), contextIsolation: true, sandbox: true } });
    const errors = []; w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message); });
    await w.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'digest', 'index.html')); await sleep(3000);
    const js = s => w.webContents.executeJavaScript(s);
    await js(`document.querySelector('.tabs [data-s="sheet4"]').click()`); await sleep(1200);
    const acc = await js(`[...document.querySelectorAll('#alr .bd')].map(b=>(b.dataset.fdLogo==='1'?'logo':'letter:'+b.textContent)+' '+b.nextSibling.textContent.trim())`);
    ok(acc.filter(x => x.startsWith('logo')).length === 4, 'капитал: логотипы у счетов Яндекса и Сбера — ' + acc.filter(x => x.startsWith('logo')).length + ' из ' + acc.length);
    ok(acc.some(x => /^letter:А Карта, Альфа/.test(x)) && acc.some(x => /^letter:Н Наличные/.test(x)), 'без логотипа (Альфа — мелкий значок, наличные) — буква');
    ok(await js(`/Логотипы — с сайтов банков/.test(document.getElementById('sheet4').textContent)`), 'подпись под счетами обновлена');
    await js(`document.querySelector('#alr').scrollIntoView({block:'center'})`); await sleep(300);
    fs.writeFileSync(path.join(OUT, 'logos-capital.png'), (await w.webContents.capturePage()).toPNG());
    await js(`document.querySelector('.tabs [data-s="sheet6"]').click()`); await sleep(1200);
    const shop = await js(`(()=>{const b=[...document.querySelectorAll('#shops li')].find(l=>/Пятёрочка/.test(l.textContent));return b?{img:!!b.querySelector('img.lo'),logo:!!b.querySelector('.bd.fd-logo')}:null})()`);
    ok(shop && (shop.img || shop.logo), 'магазины: у Пятёрочки логотип');
    await js(`document.getElementById('shops').scrollIntoView({block:'center'})`); await sleep(300);
    fs.writeFileSync(path.join(OUT, 'logos-shops.png'), (await w.webContents.capturePage()).toPNG());
    // выключатель
    S.patch('network', { logos: false });
    ok(Object.keys(await logos.get([{ name: 'Сбер', site: 'sberbank.ru' }])).length === 0, 'выключено в настройках — логотипы не загружаются');
    ok(!errors.length, 'ошибок нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
    srv.close();
  } catch (e) { console.error(e); process.exitCode = 1; }
  app.exit(process.exitCode || 0);
});
