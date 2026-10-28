'use strict';
/**
 * 0.9.0: цели вровень со справкой, подсказки вкладок только у значков, полупрозрачный «баланс ±», удаление подключённого ИИ,
 * «Вы, регион и РФ» с выбором субъекта и данными от ИИ, другое имущество с суммой сверху, тёмная тема = «Полночь», возвраты-подарки.
 * xvfb-run -a electron --no-sandbox test/v09-test.js <папка> <выгрузка Zenmoney>
 */
const path = require('path');
process.env.FD_AI_MOCK = path.join(__dirname, 'fixtures', 'ai-mock.js');
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const os = require('os');
const OUT = process.argv[process.argv.length - 2]; const FIX = process.argv[process.argv.length - 1];
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'fd-v09-')));
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
    // подключённый ИИ (DeepSeek) с ключом — для проверки удаления
    await require('../src/main/config/secrets').set('deepseek_api_key', 'sk-test-0000000000000000');
    S.patch('ai', { enabled: { ...S.get().ai.enabled, deepseek: true } });
    require('../src/main/ipc').register({});

    /* возвраты: подарки на день рождения уменьшают траты на праздник, но не ниже нуля */
    const { build } = require('../src/main/digest/build');
    const f = require('./mcp-fixture')(FIX, '2026-10-27');
    const D = build(f);
    const tot = D.TX.flat().reduce((a, r) => a + r[1], 0);
    const spentBd = f.tx.filter(t => t.date >= '2026-10-01' && t.outAcc && !t.inAcc && (f.categories[t.cat] || {}).name === 'День рождения').reduce((a, t) => a + t.outAmt, 0);
    ok(spentBd > 0 && !D.signals.refunds.some(r => r.catName === 'День рождения'), `«День рождения» (доходная категория): переданные ${Math.round(spentBd)} ₽ — не расход, подарки — доход, не возврат`);
    ok(tot < 130000, `расходы октября с возвратами — ${Math.round(tot)} ₽ (как в Zenmoney)`);

    const w = new BrowserWindow({ show: true, width: 1440, height: 900, webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload', 'preload.js'), contextIsolation: true, sandbox: true } });
    w.setContentSize(1440, 900);
    const errors = []; w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message); });
    await w.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'digest', 'index.html')); await sleep(3000);
    const js = s => w.webContents.executeJavaScript(s);
    const shot = n => w.webContents.capturePage().then(i => fs.writeFileSync(path.join(OUT, n + '.png'), i.toPNG()));
    const go = id => js(`document.querySelector('.tabs [data-s="${id}"]').click()`).then(() => sleep(400));

    /* цели вровень со справкой */
    const gr = await js(`(()=>{const [a,b]=[...document.querySelectorAll('#fd-goalrow>.c')].map(e=>e.getBoundingClientRect());return {t:Math.abs(a.top-b.top),b:Math.abs(a.bottom-b.bottom)}})()`);
    ok(gr.t < 1 && gr.b < 1, `«Цели и прогноз» и «Справка» — одной высоты (верх ${gr.t}, низ ${gr.b} px)`);
    /* подсказки вкладок */
    ok(await js(`[...document.querySelectorAll('.tabs button')].every(b=>!b.dataset.tip)`), 'широкое окно: у вкладок с подписями всплывающих подсказок нет');
    w.setContentSize(900, 900); await sleep(600);
    const tips = await js(`({mode:document.querySelector('.top .in').dataset.tabs,n:[...document.querySelectorAll('.tabs button')].filter(b=>b.dataset.tip).length})`);
    const hid = await js(`[...document.querySelectorAll('.tabs button')].filter(b=>![...b.querySelectorAll('.tl,.ts')].some(x=>x.getClientRects().length&&getComputedStyle(x).display!=='none')).length`);
    ok(hid > 0 && tips.n === hid, `окно 900 px (${tips.mode}): подсказки только у вкладок-значков — ${tips.n} из ${hid}`);
    w.setContentSize(1440, 900); await sleep(600);
    /* баланс ± */
    await go('sheet2');
    const bar = await js(`(()=>{const r=[...document.querySelectorAll('#mc rect, #mc path')].map(e=>e.getAttribute('style')||'').find(f=>/var\\(--pos\\)/.test(f));return r||''})()`);
    ok(/color-mix\(in srgb,var\(--pos\) 38%/.test(bar), '«Баланс +/−» — полупрозрачные столбцы (' + bar.slice(0, 40) + '…)');

    /* регион */
    const r0 = await js(`({n:document.querySelectorAll('#rg-sel option').length,v:document.getElementById('rg-sel').value,th:document.getElementById('rg-th').textContent,sal:document.getElementById('rg-salary').textContent})`);
    ok(r0.n === 89 && r0.v === 'Свердловская область' && r0.th === 'Свердл. обл.' && /94,8/.test(r0.sal), `субъекты РФ: ${r0.n}, по умолчанию ${r0.v} — ${r0.sal}`);
    await js(`(()=>{const s=document.getElementById('rg-sel');s.value='Москва';s.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(1500);
    const r1 = await js(`({th:document.getElementById('rg-th').textContent,sal:document.getElementById('rg-salary').textContent,food:document.getElementById('rg-food').textContent,cafe:document.getElementById('rg-cafe').textContent,rf:document.getElementById('rf-salary').textContent,note:document.getElementById('rg-note').textContent,dl:document.getElementById('dl').textContent})`);
    ok(r1.th === 'Москва' && /160/.test(r1.sal) && /24,5/.test(r1.food), `Москва: зарплата ${r1.sal}, продукты ${r1.food}`);
    ok(/нет данных/.test(r1.cafe), 'неправдоподобное значение от ИИ (999%) отброшено — «нет данных»');
    ok(/115/.test(r1.rf) && /медиана ≈ 76/.test(r1.rf), 'РФ обновлена: ' + r1.rf);
    ok(/Найдено ИИ \(mock\)/.test(r1.note) && /Тест-стат/.test(r1.note), 'подпись: источник и что данные нашёл ИИ');
    ok(/Москва: выше/.test(r1.dl), '«Где вы по доходам» — кривая выбранного региона: ' + r1.dl.slice(0, 60));
    ok(S.get().app.region === 'Москва', 'выбор субъекта сохранён в настройках');
    await js(`document.getElementById('fd-region').scrollIntoView({block:'center'})`); await sleep(300); await shot('region');

    /* имущество */
    await go('sheet3');
    const pv0 = await js(`document.getElementById('pv').textContent`);
    ok(await js(`document.querySelectorAll('#fd-assets .fd-as-chip').length===7`), 'имущество: 7 типов для добавления');
    await js(`document.querySelector('#fd-assets [data-add="car"]').click()`); await sleep(400);
    await js(`document.querySelector('#fd-assets [data-add="house"]').click()`); await sleep(400);
    const as = await js(`({n:document.querySelectorAll('#fd-assets .fd-asset').length,car:document.querySelector('#fd-assets .fd-asset[data-i="0"] [data-v="0"]').textContent,house:document.querySelector('#fd-assets [data-v="1"]').textContent,carF:[...document.querySelectorAll('#fd-assets .fd-asset[data-i="0"] .fm input')].map(i=>i.dataset.k).join(','),col:getComputedStyle(document.querySelector('#fd-assets .fd-asset[data-i="0"]')).borderTopColor,tot:(document.getElementById('fd-ptot')||{}).textContent,lab:document.querySelector('#sheet3 .hero .l').textContent,pvh:document.getElementById('pv').hidden})`);
    const num = s => +String(s).replace(/[^\d]/g, '');
    ok(as.n === 2 && /model,year,price,bought,km/.test(as.carF), 'машина — свои поля: ' + as.carF);
    ok(/rgb\(217, 130, 43|0\.85098 0\.5098/.test(as.col), 'карточка машины в своём цвете (' + as.col + ')');
    ok(as.pvh && num(as.tot) === num(pv0) + num(as.car) + num(as.house), `сверху — сумма: ${pv0} + ${as.car} + ${as.house} = ${as.tot} (${as.lab})`);
    await js(`(()=>{const i=document.querySelector('#fd-assets [data-i="1"][data-k="manual"]');i.value='9000000';i.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(600);
    ok(num(await js(`document.getElementById('fd-ptot').textContent`)) === num(pv0) + num(as.car) + 9000000, 'своя оценка дома учтена в сумме');
    await js(`document.querySelector('#fd-assets').scrollIntoView({block:'start'});window.scrollBy(0,-380)`); await sleep(300); await shot('assets');
    const saved = await js(`window.fdNative.store.get('assets','list')`);
    ok(saved.exists && saved.data.items.length === 2 && saved.data.items[1].manual === 9000000, 'имущество сохранено в базе');
    await js(`document.querySelector('#fd-assets [data-del="0"]').click()`); await sleep(500);
    await js(`document.querySelector('#fd-assets [data-del="0"]').click()`); await sleep(500);
    ok(await js(`!document.getElementById('fd-ptot') && !document.getElementById('pv').hidden && document.querySelector('#sheet3 .hero .l').textContent==='Оценочная стоимость'`), 'удалили всё — верхний блок снова только про квартиру');

    /* удаление подключённого ИИ */
    await js(`document.getElementById('cnb').click()`); await sleep(500);
    await js(`document.querySelector('#cnp [data-t="ai"]').click()`); await sleep(400);
    ok(await js(`!document.querySelector('#cnp [data-t="look"]')`), 'вкладки «Вид» в «Подключениях» больше нет');
    ok(await js(`!!document.querySelector('#cnp .cn-card[data-p="deepseek"] [data-remove="deepseek"]')`), 'у подключённого ИИ есть крестик «Удалить»');
    await js(`document.querySelector('[data-remove="deepseek"]').click()`); await sleep(400);
    const cf = await js(`(()=>{const o=document.getElementById('cf');if(!o||o.hidden)return null;const r=o.getBoundingClientRect(),p=document.getElementById('cnp');return {z:+getComputedStyle(o).zIndex||0,zp:+getComputedStyle(p).zIndex||0,t:document.getElementById('cfT').textContent,top:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('#cf')!=null}})()`);
    ok(cf && cf.top && /secrets\.json/.test(cf.t), 'подтверждение удаления поверх панели: ' + (cf ? cf.t.slice(0, 60) : 'нет'));
    await shot('ai-remove-confirm');
    await js(`(()=>{const b=[...document.querySelectorAll('#cf button')].find(b=>/Удалить|Да|ОК/i.test(b.textContent));b.click()})()`); await sleep(900);
    const st = await js(`window.fdNative.conn.status()`);
    const ds = st.ai.find(p => p.id === 'deepseek');
    ok(!ds.enabled && !ds.hasKey && await js(`!document.querySelector('#cnp .cn-card[data-p="deepseek"]') && !!document.querySelector('#cnp .cn-tile[data-add="deepseek"]')`), 'DeepSeek удалён: ключ стёрт, выключен, снова плиткой в «Добавить ИИ»');
    await js(`document.getElementById('cnx').click()`); await sleep(400);

    /* тёмная тема = «Полночь» */
    await go('sheet1');
    await js(`document.documentElement.setAttribute('data-theme','dark')`); await sleep(400);
    const dk = await js(`({ac:getComputedStyle(document.documentElement).getPropertyValue('--ac').trim(),bg:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),skin:document.documentElement.dataset.skin||''})`);
    ok(dk.ac.toUpperCase() === '#3FC1EE' && dk.bg.toUpperCase() === '#0B0E13' && !dk.skin, `тёмная тема — цвета «Полночи» (${dk.ac}, ${dk.bg})`);
    await js(`window.scrollTo(0,0)`); await sleep(200); await shot('dark-midnight');
    await js(`document.documentElement.setAttribute('data-theme','light')`); await sleep(300);
    const lt = await js(`getComputedStyle(document.documentElement).getPropertyValue('--ac').trim()`);
    ok(lt.toUpperCase() !== '#3FC1EE', 'светлая тема — исходный вид (' + lt + ')');
    await shot('light-original');
    ok(!errors.length, 'ошибок нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  } catch (e) { console.error(e); process.exitCode = 1; }
  app.exit(process.exitCode || 0);
});
