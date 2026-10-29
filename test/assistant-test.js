'use strict';
/**
 * Помощник: защита SQL, двухшаговый ответ по базе, голос (фиктивный микрофон Chromium → WAV → расшифровка → ответ),
 * панель на широком и узком окне. Скриншоты — в папку из аргумента.
 * FD_AI_MOCK=test/fixtures/ai-mock.js xvfb-run -a electron --no-sandbox test/assistant-test.js <папка> <выгрузка Zenmoney>
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path');
const OUT = process.argv[process.argv.length - 2]; const FIX = process.argv[process.argv.length - 1];
process.env.FD_AI_MOCK = process.env.FD_AI_MOCK || path.join(__dirname, 'fixtures', 'ai-mock.js');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-as-')); app.setPath('userData', DATA);
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    require('../src/main/paths').P.ensure();
    const S = require('../src/main/config/settings'); S.load(); await require('../src/main/config/secrets').load();
    const D = require('../src/main/db/database'); D.open();
    require('../src/main/connectors/zenmoney').apply(require('./mcp-to-diff')(FIX));
    S.patch('zenmoney', { enabled: true, lastSync: new Date().toISOString() });
    S.patch('firstRunDone', true);
    S.patch('assistant', { tts: 'off', speak: false });
    require('../src/main/ipc').register({});

    /* 1. Защита запросов */
    const sql = require('../src/main/assistant/sql');
    const bad = ['DELETE FROM zm_tx', 'SELECT 1; DROP TABLE zm_tx', 'PRAGMA table_info(zm_tx)', "WITH x AS (SELECT 1) DELETE FROM zm_tx", 'ATTACH DATABASE \'x\' AS y', 'UPDATE docs SET v=1'];
    ok(bad.every(q => { try { sql.run(q); return false; } catch (_) { return true; } }), 'запросы на изменение базы отклоняются (' + bad.length + ')');
    const n0 = D.db.prepare('SELECT COUNT(*) n FROM zm_tx').get().n;
    const prod = sql.run("SELECT ROUND(SUM(amount_rub),2) s FROM v_ops WHERE type='expense' AND in_balance=1 AND category='Продукты' AND month='2026-09'").rows[0].s;
    ok(Math.abs(prod - 18619.57) < 0.01, `продукты за сентябрь 2026 по базе: ${prod} (Zenmoney: 18619.57)`);
    const acc = sql.run('SELECT COUNT(*) n, ROUND(SUM(balance_rub)) s FROM v_accounts WHERE in_balance=1 AND archive=0').rows[0];
    ok(acc.n > 0, `счета: ${acc.n}, сумма ${acc.s}`);

    /* 2. Двухшаговый ответ */
    const assistant = require('../src/main/assistant/assistant');
    const r = await assistant.ask({ question: 'Сколько ушло на продукты в сентябре?' });
    ok(r.provider === 'mock' && r.queries.length === 3, 'ИИ запросил 3 выборки, выполнено: ' + r.queries.map(q => q.error ? 'отклонено' : q.rows + ' стр.').join(', '));
    ok(r.queries[1].error && r.queries[2].error, 'опасные запросы ИИ не выполнены: ' + r.queries[1].error + ' / ' + r.queries[2].error);
    ok(r.answer.includes('18619.57'), 'ответ построен по результату: ' + r.answer.split('\n')[0]);
    ok(D.db.prepare('SELECT COUNT(*) n FROM zm_tx').get().n === n0, 'база не изменилась');
    const ctx = require('./fixtures/ai-mock.js').calls[0].system;
    ok(ctx.includes('Сводка данных') && ctx.includes('v_ops'), 'ИИ получает сводку и схему (' + Math.round(ctx.length / 1024) + ' КБ)');
    ok(assistant.history().length === 1, 'вопрос записан в журнал');

    /* 3. Интерфейс: текст и голос */
    const w = new BrowserWindow({ show: true, width: 1320, height: 900, webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload', 'preload.js'), contextIsolation: true, sandbox: true } });
    const errors = []; w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message + ' @' + (e.sourceId || '').split('/').pop() + ':' + e.lineNumber); });
    await w.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'digest', 'index.html'));
    await sleep(3500);
    const js = s => w.webContents.executeJavaScript(s);
    const hdr = await js(`(()=>{const b=document.getElementById('asb');return {inActs:!!b&&b.parentNode.classList.contains('fd-actions'),first:b&&b.parentNode.firstElementChild===b}})()`);
    ok(hdr.inActs && hdr.first, 'кнопка помощника в шапке, первая среди действий');
    await js(`document.getElementById('asb').click()`); await sleep(400);
    const st = await js(`({open:!document.getElementById('asp').hidden,msgs:document.querySelectorAll('#as-log .as-msg').length,status:document.getElementById('as-st').textContent,mic:!document.getElementById('as-mic').disabled})`);
    ok(st.open && st.msgs === 2, `панель открыта, история подгружена (${st.msgs} сообщ.)`);
    ok(st.mic && /тест/.test(st.status), 'статус: ' + st.status);
    // текст
    await js(`(()=>{const t=document.getElementById('as-in');t.value='Привет';t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);
    await sleep(800);
    const last = await js(`[...document.querySelectorAll('#as-log .as-msg.a')].pop().textContent`);
    ok(/Привет! Спросите/.test(last), 'текстовый вопрос → ответ: ' + last.slice(0, 40));
    // голос: фиктивный микрофон Chromium, ручная остановка
    await js(`window.fdNative.assistant.set({autoStop:false})`);
    await js(`document.getElementById('as-mic').click()`); await sleep(2500);
    const rec = await js(`({on:document.getElementById('as-rec').classList.contains('on'),btn:document.getElementById('asb').classList.contains('rec'),lvl:document.getElementById('as-lvl').style.transform})`);
    ok(rec.on && rec.btn, 'идёт запись, уровень ' + rec.lvl);
    fs.writeFileSync(path.join(OUT, 'assistant-rec.png'), (await w.webContents.capturePage()).toPNG());
    await js(`document.getElementById('as-mic').click()`); await sleep(2000);
    const v = await js(`(()=>{const m=[...document.querySelectorAll('#as-log .as-msg')];return {u:m.filter(x=>x.classList.contains('u')).pop().textContent,a:m.filter(x=>x.classList.contains('a')).pop().textContent,q:!!m.pop().querySelector('.as-meta button')}})()`);
    ok(/продукты в сентябре/.test(v.u), 'голос расшифрован: ' + v.u);
    ok(/18619\.57/.test(v.a) && v.q, 'голосовой вопрос → ответ по базе, видны запросы');
    const bytes = require('./fixtures/ai-mock.js').lastAudioBytes;
    ok(bytes > 40000 && bytes < 32000 * 4, `WAV 16 кГц ≈ ${(bytes / 32000).toFixed(1)} с (${bytes} байт)`);
    const log = D.db.prepare('SELECT voice FROM assistant_log ORDER BY id DESC LIMIT 1').get();
    ok(log.voice === 1, 'в журнале отмечено «голосом»');
    // настройки
    await js(`document.getElementById('as-gear').click()`); await sleep(300);
    const set = await js(`({n:document.querySelectorAll('#as-set select').length,c:document.querySelectorAll('#as-set input[type=checkbox]').length})`);
    ok(set.n >= 2 && set.c === 3, `настройки голоса: ${set.n} списка, ${set.c} флажка`);
    await js(`document.getElementById('as-gear').click()`); await sleep(200);
    fs.writeFileSync(path.join(OUT, 'assistant-1320.png'), (await w.webContents.capturePage()).toPNG());
    // узкое окно
    w.setContentSize(420, 860); await sleep(600);
    const nar = await js(`(()=>{const p=document.getElementById('asp').getBoundingClientRect(),b=document.getElementById('asb').getBoundingClientRect();return {fit:p.left>=0&&p.right<=innerWidth&&p.bottom<=innerHeight,btn:b.width>0&&b.right<=innerWidth,h:document.documentElement.scrollWidth<=innerWidth+1}})()`);
    ok(nar.fit && nar.btn && nar.h, '420px: панель и кнопка в пределах окна, без горизонтальной прокрутки');
    fs.writeFileSync(path.join(OUT, 'assistant-420.png'), (await w.webContents.capturePage()).toPNG());
    // Escape закрывает
    await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await sleep(200);
    ok(await js(`document.getElementById('asp').hidden`), 'Escape закрывает панель');
    // горячая клавиша (сигнал из основного процесса) открывает и начинает слушать
    w.webContents.send('assistant:listen'); await sleep(1200);
    ok(await js(`!document.getElementById('asp').hidden && document.getElementById('as-rec').classList.contains('on')`), 'горячая клавиша: панель открыта, запись началась');
    await js(`document.getElementById('as-cancel').click()`);
    ok(!errors.length, 'ошибок нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  } catch (e) { console.error(e); process.exitCode = 1; }
  app.exit(process.exitCode || 0);
});
