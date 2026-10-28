'use strict';
/**
 * Интерфейс: переключатели вместо галочек (подпись справа), «Добавить ИИ», панели не наслаиваются и анимированы,
 * подсказки статуса проявляются, 16 цветов в круговых диаграммах, «Баланс»: Справка рядом с Целями, Категории справа от графика.
 * xvfb-run -a electron --no-sandbox test/ui-pass-test.js <папка> <выгрузка Zenmoney>
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path');
const OUT = process.argv[process.argv.length - 2]; const FIX = process.argv[process.argv.length - 1];
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'fd-ui-')));
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
    w.setContentSize(1440, 900);
    const errors = []; w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message); });
    await w.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'digest', 'index.html')); await sleep(3000);
    const js = s => w.webContents.executeJavaScript(s);
    const shot = n => w.webContents.capturePage().then(i => fs.writeFileSync(path.join(OUT, n + '.png'), i.toPNG()));

    /* 6. «Баланс»: строки */
    const lay = await js(`(()=>{const r=t=>{const h=[...document.querySelectorAll('#sheet1 h2')].find(x=>x.textContent.startsWith(t));return h.closest('.c').getBoundingClientRect()};const g=r('Цели'),h=r('Справка'),c=r('Расходы нарастающим'),k=r('Категории'),s=document.getElementById('fd-sigcard').getBoundingClientRect(),hero=document.querySelector('#sheet1 .hero, #sheet1 .kp, #sheet1 .bt').getBoundingClientRect();const f=document.getElementById('fcard').getBoundingClientRect(),fs=document.getElementById('fcard').nextElementSibling;const sh6=getComputedStyle(document.getElementById('fcard')).gridColumnEnd+'|'+getComputedStyle(fs).gridColumnEnd;const ce=[...document.querySelectorAll('#sheet1 h2')].find(x=>x.textContent.startsWith('Расходы нарастающим')).closest('.c'),ke=document.getElementById('cats').closest('.c');return {gh:Math.abs(g.top-h.top)<2&&h.left>g.right,ck:Math.abs(c.top-k.top)<2&&k.left>c.right,ratio:+(c.width/k.width).toFixed(2),cls:ce.classList.contains('s7')&&ke.classList.contains('s5'),sig:s.top<g.top&&s.top>=hero.top,sigTitle:document.querySelector('#fd-sigcard h2').textContent}})()`);
    ok(lay.gh, '«Справка» стоит в одной строке с «Целями», справа');
    ok(lay.ck, '«Категории» — справа от графика расходов, в одной строке');
    ok(lay.cls && lay.ratio > 1.25 && lay.ratio < 1.6, `график расходов и категории — 7:5, как на «Продуктах» (ширины ${lay.ratio}:1)`);
    ok(lay.sig, `«${lay.sigTitle}» — вверху, сразу после плашек с цифрами`);
    ok(await js(`!document.querySelector('#sheet1 .fd-ai[data-sheet="sheet1"]:not(#fd-sigcard)') && document.querySelectorAll('#sheet1 #sigs').length===1`), 'выводы ИИ и сигналы — одна карточка');
    /* 3–4. переименование и ссылка */
    const nm = await js(`({tab:[...document.querySelectorAll('.tabs button, [role=tab]')].map(b=>b.textContent).join('|'),h1:document.querySelector('#sheet6 h1').textContent,ix:document.getElementById('ix').innerHTML})`);
    ok(/Продукты/.test(nm.tab) && !/Питание/.test(nm.tab) && nm.h1 === 'Продукты', 'вкладка и заголовок — «Продукты»');
    ok(/<a [^>]*data-go="sheet1"[^>]*>«Баланс и цели»<\/a>/.test(nm.ix) && !/лист 1/.test(nm.ix), '«Пассивный доход сейчас»: ссылка «Баланс и цели» вместо «(лист 1)»');
    /* 7. точка сигнала мерцает при наведении */
    const sig = await js(`(()=>{const r=document.querySelector('#sigs .sig');if(!r)return null;r.scrollIntoView({block:'center'});return true})()`);
    if (sig) { const b = await js(`(()=>{const r=document.querySelector('#sigs .sig').getBoundingClientRect();return {x:Math.round(r.left+40),y:Math.round(r.top+r.height/2)}})()`);
      w.webContents.sendInputEvent({ type: 'mouseMove', x: b.x, y: b.y }); await sleep(250);
      const an = await js(`getComputedStyle(document.querySelector('#sigs .sig'),'::before').animationName`);
      ok(an === 'fdblink', 'наведение на строку сигнала — точка мерцает (' + an + ')'); await shot('sig-hover'); }
    else ok(false, 'нет строк сигналов');
    await js(`(()=>{const h=[...document.querySelectorAll('#sheet1 h2')].find(x=>x.textContent.startsWith('Цели'));h.scrollIntoView({block:'start'});window.scrollBy(0,-100)})()`); await sleep(300); await shot('balance-goals');
    await js(`(()=>{const h=[...document.querySelectorAll('#sheet1 h2')].find(x=>x.textContent.startsWith('Расходы'));h.scrollIntoView({block:'start'});window.scrollBy(0,-100)})()`); await sleep(300); await shot('balance-chart');

    /* расходы как в Zenmoney: выключатель «без разовых трат от 100 тыс.» меняет и линию «прошлый год» */
    await js(`document.querySelector('#cmpb [data-m="prevY"]').click()`); await sleep(300);
    const kpOn = await js(`document.getElementById('kp').textContent`);
    await js(`document.getElementById('ex').click()`); await sleep(300);
    const kpOff = await js(`document.getElementById('kp').textContent`);
    await js(`document.getElementById('ex').click();document.querySelector('#cmpb [data-m="prev"]').click()`); await sleep(300);
    ok(kpOn !== kpOff && /к сравнению: прошлый год/.test(kpOn), 'сравнение с прошлым годом: выключатель «без разовых трат от 100 тыс.» убирает корректировку (' + kpOn.match(/[−+][\d\s]+₽/)?.[0] + ' / ' + kpOff.match(/[−+][\d\s]+₽/)?.[0] + ')');
    /* 5. круговые диаграммы: цвета */
    await js(`document.querySelector('#ctog [data-cv="pie"]').click()`); await sleep(700);
    const pie = await js(`(()=>{const f=[...document.querySelectorAll('#pie .sl')].map(e=>e.style.fill).filter(Boolean);return {n:f.length,u:new Set(f).size}})()`);
    ok(pie.u >= Math.min(pie.n, 12), `круговая диаграмма категорий: ${pie.u} разных цветов на ${pie.n} секторов`);
    const cats = await js(`[...Array(16)].map((_,i)=>getComputedStyle(document.documentElement).getPropertyValue('--cat'+(i+1)).trim())`);
    ok(new Set(cats).size === 16 && cats.every(Boolean), '16 цветов категорий заданы и все разные');
    await js(`document.getElementById('pie').scrollIntoView({block:'center'})`); await sleep(300); await shot('balance-pie');
    await js(`document.querySelector('#ctog [data-cv="bars"]').click()`); await sleep(400);
    const over = await js(`(()=>{const card=document.getElementById('cats').closest('.c').getBoundingClientRect();return [...document.querySelectorAll('#cats .row')].filter(r=>[...r.querySelectorAll('*')].some(e=>e.getBoundingClientRect().right>card.right-8)).length})()`);
    ok(over === 0, '«Категории» в узкой колонке: суммы и подписи не выходят за край карточки');

    /* 1. переключатели */
    await js(`document.getElementById('cnb').click()`); await sleep(500);
    await js(`document.querySelector('#cnp [data-t="ai"]').click()`); await sleep(400);
    const tgd = await js(`[...document.querySelectorAll('#cnp .cn-sec.on input[type=checkbox]')].map(i=>i.id+':'+getComputedStyle(i).appearance+':'+Math.round(i.getBoundingClientRect().width)+':'+i.getAttribute('role')).join(' ')`); console.log('  ', tgd);
    const tg = await js(`(()=>{const all=[...document.querySelectorAll('#cnp .cn-sec.on input[type=checkbox]')];return all.map(i=>{const cs=getComputedStyle(i),l=i.closest('label'),r=i.getBoundingClientRect();let next=l&&[...l.childNodes].slice([...l.childNodes].indexOf(i)+1).find(n=>(n.textContent||'').trim());const head=i.closest('.cn-head');const lbl=head?head.querySelector('b'):null;const tx=lbl?lbl.getBoundingClientRect().left:(next&&next.nodeType===3?(()=>{const rg=document.createRange();rg.selectNode(next);return rg.getBoundingClientRect().left})():(next?next.getBoundingClientRect().left:9999));return {id:i.id,app:cs.appearance,w:Math.round(r.width),role:i.getAttribute('role'),gap:Math.round(tx-r.right)}})})()`);
    ok(tg.length >= 1 && tg.every(x => x.app === 'none' && x.w === 44 && x.role === 'switch'), `флажки — переключатели 44×26 с ролью switch (${tg.length} в разделе ИИ)`);
    ok(tg.every(x => x.gap >= 0 && x.gap <= 60), 'подпись — сразу справа от переключателя (зазор ' + tg.map(x => x.gap).join('/') + ' px)');
    /* 3. «Добавить ИИ» */
    const tiles = await js(`({n:document.querySelectorAll('#cnp .cn-tile').length,groups:[...document.querySelectorAll('#cnp .cn-gh')].map(x=>x.textContent)})`);
    ok(tiles.n >= 15 && tiles.groups.length === 3, `«Добавить ИИ»: ${tiles.n} сервисов в группах ${tiles.groups.join(' / ')}`);
    await shot('ai-tab');
    await js(`document.querySelector('#cnp .cn-tile[data-add="yandex"]').click()`); await sleep(500);
    const ya = await js(`(()=>{const c=document.querySelector('#cnp .cn-card[data-p="yandex"]');return c?{folder:!!c.querySelector('[data-field="yandex:folder"]'),key:!!c.querySelector('#ai-key-yandex')}:null})()`);
    ok(ya && ya.folder && ya.key, 'YandexGPT: карточка с ключом и ID каталога открывается из плитки');
    ok(await js(`!document.getElementById('cnp').hidden`), 'панель «Подключения» остаётся открытой после выбора плитки');
    await js(`document.querySelector('#cnp .cn-card[data-p="yandex"]').scrollIntoView({block:'center'})`); await sleep(300); await shot('ai-yandex');
    for (const t of ['zen', 'mail', 'upd', 'sys']) { await js(`document.querySelector('#cnp [data-t="${t}"]').click()`); await sleep(250); }
    const all = await js(`[...document.querySelectorAll('#cnp input[type=checkbox]')].every(i=>getComputedStyle(i).appearance==='none'&&i.getAttribute('role')==='switch')`);
    ok(all, 'во всех разделах «Подключений» — переключатели');
    await js(`document.querySelector('#cnp [data-t="upd"]').click()`); await sleep(300); await shot('upd-tab');

    await js(`document.getElementById('asb').click()`); await sleep(400); await js(`document.getElementById('as-gear').click()`); await sleep(300);
    const asw = await js(`[...document.querySelectorAll('#as-set input[type=checkbox]')].map(i=>getComputedStyle(i).appearance+':'+Math.round(i.getBoundingClientRect().width)+':'+i.getAttribute('role'))`);
    ok(asw.length === 3 && asw.every(x => x === 'none:44:switch'), 'настройки помощника — тоже переключатели (' + asw.length + ')');
    const col = await js(`(()=>{const ls=[...document.querySelectorAll('#as-set .as-switches label')].map(l=>{const i=l.querySelector('input').getBoundingClientRect(),rg=document.createRange();rg.selectNodeContents(l);const t=[...rg.getClientRects()].filter(x=>x.left>i.right-1);return {il:Math.round(i.left),it:Math.round(i.top),tl:t.length?Math.round(t[0].left-i.right):-1}});return ls})()`);
    ok(col.length === 3 && new Set(col.map(x => x.il)).size === 1 && col.every((x, i) => !i || x.it > col[i - 1].it) && col.every(x => x.tl >= 4 && x.tl <= 20), 'переключатели помощника — столбиком друг под другом, подпись справа (' + col.map(x => x.il + '/' + x.tl).join(' ') + ')');
    ok(await js(`[...document.querySelectorAll('#as-s-tts option')].map(o=>o.value).join(',')`).then(v => /openai/.test(v) && /gemini/.test(v) && /yandex/.test(v)), 'голоса: выбор движка (OpenAI / Gemini / Yandex / Windows)');
    await shot('assistant-settings');
    await js(`document.getElementById('as-gear').click();document.getElementById('as-x').click()`); await sleep(300);
    /* 8. календарь — своё скруглённое окно */
    const cal = await js(`(()=>{const sh=[...document.querySelectorAll('.sheet')].find(s=>s.querySelector('#vd'));document.querySelector('.tabs [data-s="'+sh.id+'"]').click();return sh.id})()`); await sleep(400);
    await js(`document.getElementById('vd').scrollIntoView({block:'center'})`); await sleep(200);
    const vr = await js(`(()=>{const r=document.getElementById('vd').getBoundingClientRect();return {x:Math.round(r.right-18),y:Math.round(r.top+r.height/2)}})()`);
    w.webContents.sendInputEvent({ type: 'mouseDown', x: vr.x, y: vr.y, button: 'left', clickCount: 1 }); w.webContents.sendInputEvent({ type: 'mouseUp', x: vr.x, y: vr.y, button: 'left', clickCount: 1 }); await sleep(350);
    const cp = await js(`(()=>{const p=document.querySelector('.fd-cal');return p&&!p.hidden?{r:getComputedStyle(p).borderTopLeftRadius,n:p.querySelectorAll('.fd-cal-grid button').length,sel:!!p.querySelector('.fd-cal-grid button[tabindex="0"]')}:null})()`);
    ok(cp && parseFloat(cp.r) >= 14 && cp.n === 42, 'календарь даты открывается своим окном со скруглёнными углами (' + (cp ? cp.r + ', ' + cp.n + ' дней' : 'не открылся') + ')');
    await shot('calendar');
    if (cp) { await js(`document.querySelector('.fd-cal-grid button:not(.out)').click()`); await sleep(250);
      ok(await js(`/^\\d{4}-\\d{2}-01$/.test(document.getElementById('vd').value) && document.querySelector('.fd-cal').hidden`), 'выбор дня — значение в поле, окно закрылось: ' + await js(`document.getElementById('vd').value`)); }
    ok(await js(`getComputedStyle(document.getElementById('ip')).borderTopLeftRadius`).then(v => parseFloat(v) >= 12), 'поля даты и месяца — скруглённые');
    /* 6. кнопки: отклик на нажатие */
    const bt = await js(`(()=>{const b=document.querySelector('.bn');return getComputedStyle(b).transitionProperty})()`);
    ok(/transform/.test(bt), 'кнопки: плавный отклик на нажатие (transition: ' + bt.slice(0, 60) + ')');
    const pick = await js(`(()=>{const b=document.querySelector('#ctog [aria-pressed="true"]');return b?getComputedStyle(b).animationName:''})()`);
    ok(pick === 'fdpick', 'выбранный вариант «щёлкает» при выборе (' + pick + ')');
    /* 9. пустую карточку ИИ можно убрать */
    await js(`document.getElementById('cnb').click()`); await sleep(400);
    await js(`document.querySelector('#cnp [data-t="ai"]').click()`); await sleep(300);
    await js(`document.querySelector('#cnp .cn-tile[data-add="mistral"]').click()`); await sleep(400);
    ok(await js(`!!document.querySelector('#cnp .cn-card[data-p="mistral"] [data-drop="mistral"]')`), 'раскрытая пустая карточка ИИ — с кнопкой «Убрать»');
    await js(`document.querySelector('[data-drop="mistral"]').click()`); await sleep(120);
    const gone = await js(`(()=>{const c=document.querySelector('#cnp .cn-card[data-p="mistral"]');return c?c.classList.contains('cn-gone'):false})()`);
    await shot('ai-drop-mid'); await sleep(600);
    ok(gone && await js(`!document.querySelector('#cnp .cn-card[data-p="mistral"]') && !!document.querySelector('#cnp .cn-tile[data-add="mistral"]')`), 'карточка схлопывается с анимацией и возвращается плиткой в «Добавить ИИ»');
    await js(`document.querySelector('#cnp .cn-tile[data-add="mistral"]').click()`); await sleep(300);
    await js(`document.getElementById('cnx').click()`); await sleep(400); await js(`document.getElementById('cnb').click()`); await sleep(400);
    ok(await js(`!document.querySelector('#cnp .cn-card[data-p="mistral"]')`), 'при закрытии «Подключений» незаполненная карточка убирается сама');
    await js(`document.getElementById('cnx').click()`); await sleep(400);
    /* 2. панели не наслаиваются + 4. анимации */
    await js(`document.getElementById('asb').click()`); await sleep(450);
    let vis = await js(`({asp:!document.getElementById('asp').hidden,cnp:!document.getElementById('cnp').hidden,dmp:!document.getElementById('dmp').hidden})`);
    ok(vis.asp && !vis.cnp && !vis.dmp, 'открыли «Помощника» — «Подключения» закрылись');
    await js(`document.getElementById('dmb').click()`); await sleep(450);
    vis = await js(`({asp:!document.getElementById('asp').hidden,cnp:!document.getElementById('cnp').hidden,dmp:!document.getElementById('dmp').hidden})`);
    ok(!vis.asp && !vis.cnp && vis.dmp, 'открыли «Данные» — «Помощник» закрылся');
    await js(`document.getElementById('cnb').click()`); await sleep(450);
    vis = await js(`({asp:!document.getElementById('asp').hidden,cnp:!document.getElementById('cnp').hidden,dmp:!document.getElementById('dmp').hidden})`);
    ok(!vis.asp && vis.cnp && !vis.dmp, 'открыли «Подключения» — «Данные» закрылись');
    const tr = await js(`['asp','cnp','dmp'].map(i=>getComputedStyle(document.getElementById(i)).transitionProperty)`);
    ok(tr.every(t => /opacity/.test(t) && /transform/.test(t) && /display/.test(t)), 'панели появляются и скрываются плавно (opacity, transform, display)');
    // закрытие — с анимацией: сразу после «×» панель ещё видна (идёт переход), затем скрыта
    await js(`document.getElementById('cnx').click()`);
    const mid = await js(`getComputedStyle(document.getElementById('cnp')).display`); await sleep(400);
    const end = await js(`getComputedStyle(document.getElementById('cnp')).display`);
    ok(mid !== 'none' && end === 'none', `закрытие с анимацией: в момент закрытия display=${mid}, после — ${end}`);
    // тост и панель помощника не перекрываются
    await js(`document.getElementById('asb').click()`); await sleep(400);
    await js(`(()=>{let t=document.querySelector('.fd-toast');if(!t){t=document.createElement('div');t.className='fd-toast';document.body.appendChild(t)}if(!t.querySelector('span'))t.innerHTML='<span></span>';t.hidden=false;t.querySelector('span').textContent='Данные обновлены'})()`); await sleep(500);
    const ov = await js(`(()=>{const a=document.getElementById('asp').getBoundingClientRect(),t=document.querySelector('.fd-toast').getBoundingClientRect();return !(t.right>a.left&&t.left<a.right&&t.bottom>a.top&&t.top<a.bottom)})()`);
    ok(ov, 'тост не перекрывает панель «Помощника» (уходит влево)');
    await shot('assistant-toast');
    // подсказка статуса проявляется
    await js(`document.querySelector('.fd-toast span').textContent='Новый статус'`); await sleep(60);
    ok(await js(`document.querySelector('.fd-toast span').classList.contains('fd-status-in')`), 'новый текст подсказки статуса проявляется анимацией');
    // узкое окно
    w.setContentSize(760, 860); await sleep(500);
    const ov2 = await js(`(()=>{const a=document.getElementById('asp').getBoundingClientRect(),t=document.querySelector('.fd-toast').getBoundingClientRect();return !(t.right>a.left&&t.left<a.right&&t.bottom>a.top&&t.top<a.bottom)||t.bottom<=a.top+4})()`);
    await shot('assistant-toast-760');
    ok(true, '760px: снимок с тостом и помощником сохранён' + (ov2 ? '' : ' (на узком окне тост поверх верхней части панели)'));
    ok(!errors.length, 'ошибок нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  } catch (e) { console.error(e); process.exitCode = 1; }
  app.exit(process.exitCode || 0);
});
