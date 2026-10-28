'use strict';
/**
 * Модели ИИ из API: полный список (текстовые и прочие), кеш на сутки, модель по умолчанию, ручной ввод,
 * выпадающий список в «Подключениях» (группы, скругление, раскрытый список — снимок).
 * xvfb-run -a electron --no-sandbox test/models-test.js <папка>
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path');
const OUT = process.argv[process.argv.length - 1];
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'fd-mod-')));
app.commandLine.appendSwitch('no-sandbox'); app.on('window-all-closed', () => {});
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// как отвечает Gemini: текстовые модели, предварительные версии, эмбеддинги, генерация картинок
const GEM = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-3-pro-preview', 'gemini-2.5-flash-preview-09-2025', 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemma-3-27b-it', 'gemma-3-12b-it', 'learnlm-2.0-flash-experimental']
  .map(id => ({ id, name: id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), chat: true }))
  .concat(['text-embedding-004', 'gemini-embedding-001', 'gemini-2.5-flash-image', 'imagen-4.0-generate-001', 'gemini-2.5-flash-preview-tts'].map(id => ({ id, name: id, chat: false })));

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    require('../src/main/paths').P.ensure();
    const S = require('../src/main/config/settings'); S.load();
    const sec = require('../src/main/config/secrets'); await sec.load();
    require('../src/main/db/database').open(); S.patch('firstRunDone', true);
    await sec.set('gemini_api_key', 'AIza-test-key-0000');
    S.patch('ai', { enabled: { anthropic: false, openai: false, gemini: true }, primary: 'gemini', models: { anthropic: '', openai: '', gemini: '' } });
    const ai = require('../src/main/ai/router');
    let calls = 0;
    ai.PROVIDERS.gemini.listModels = async () => { calls++; return GEM.map(x => ({ ...x })).sort((a, b) => b.chat - a.chat); };
    require('../src/main/ipc').register({});

    ok(ai.pickDefault('gemini', GEM) === 'gemini-2.5-flash' && ai.pickDefault('anthropic', [{ id: 'claude-opus-5-5', chat: true }, { id: 'claude-sonnet-5-5', chat: true }]) === 'claude-sonnet-5-5', 'модель по умолчанию: стабильная Flash у Gemini, Sonnet у Claude');
    const r1 = await ai.models('gemini');
    ok(r1.list.length === GEM.length && S.get().ai.models.gemini === 'gemini-2.5-flash', `все модели из API (${r1.list.length}), выбрана gemini-2.5-flash`);
    await ai.models('gemini');
    ok(calls === 1, 'повторно — из кеша (список хранится в настройках сутки)');
    await ai.models('gemini', { refresh: true });
    ok(calls === 2, '«Проверить и обновить список» — запрос к API заново');

    const w = new BrowserWindow({ show: true, width: 1320, height: 900, webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload', 'preload.js'), contextIsolation: true, sandbox: true } });
    const errors = []; w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message); });
    await w.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'digest', 'index.html')); await sleep(3000);
    const js = s => w.webContents.executeJavaScript(s);
    await js(`document.getElementById('cnb').click()`); await sleep(800);
    await js(`document.querySelector('#cnp [data-t="ai"]').click()`); await sleep(400);
    const sel = await js(`(()=>{const s=document.getElementById('ai-model-gemini');return {n:s.options.length,groups:[...s.querySelectorAll('optgroup')].map(g=>g.label),value:s.value,custom:!!s.querySelector('option[value="__custom"]'),info:document.getElementById('ai-mlist-gemini').textContent,radius:getComputedStyle(s).borderRadius,app:getComputedStyle(s).appearance}})()`);
    ok(sel.n === GEM.length + 1 && sel.groups.length === 2 && sel.value === 'gemini-2.5-flash', `список в «Подключениях»: ${sel.n - 1} моделей, группы: ${sel.groups.join(' / ')}`);
    ok(sel.custom && /Моделей в API: 17, для текста — 12/.test(sel.info), 'пункт «Ввести вручную…» и сводка: ' + sel.info);
    ok(sel.app === 'base-select' && sel.radius === '14px', `выпадающий список оформлен: appearance ${sel.app}, скругление ${sel.radius}`);
    ok(await js(`getComputedStyle(document.getElementById('ai-custom-gemini')).display==='none'`), 'поле ручного ввода скрыто, пока не выбран «Ввести вручную…»');
    // раскрыть список настоящим кликом и сфотографировать
    await js(`document.getElementById('ai-model-gemini').scrollIntoView({block:'center'})`); await sleep(300);
    const rc = await js(`(()=>{const r=document.getElementById('ai-model-gemini').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
    w.webContents.sendInputEvent({ type: 'mouseDown', x: rc.x, y: rc.y, button: 'left', clickCount: 1 });
    w.webContents.sendInputEvent({ type: 'mouseUp', x: rc.x, y: rc.y, button: 'left', clickCount: 1 }); await sleep(600);
    ok(await js(`document.getElementById('ai-model-gemini').matches(':open')`), 'список раскрывается по клику');
    fs.writeFileSync(path.join(OUT, 'models-open.png'), (await w.webContents.capturePage()).toPNG());
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await sleep(300);
    // ручной ввод
    await js(`(()=>{const s=document.getElementById('ai-model-gemini');s.value='__custom';s.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(300);
    ok(await js(`getComputedStyle(document.getElementById('ai-custom-gemini')).display!=='none'`), '«Ввести вручную…» открывает поле для названия');
    await js(`document.getElementById('ai-cid-gemini').value='gemini-2.5-flash-lite';document.querySelector('[data-custom="gemini"]').click()`); await sleep(700);
    ok(S.get().ai.models.gemini === 'gemini-2.5-flash-lite', 'модель, вписанная вручную, сохранена');
    // другие выпадающие списки — тоже скруглены (ЖКХ: тип квитанции; помощник: настройки)
    await js(`document.getElementById('cnx').click(); document.querySelector('.tabs [data-s="sheet5"]').click()`); await sleep(400);
    const it2 = await js(`(()=>{const s=document.getElementById('it2');return getComputedStyle(s).borderRadius+' '+getComputedStyle(s).appearance})()`);
    ok(/^14px base-select$/.test(it2), 'выпадающие списки отчёта — тоже (тип квитанции ЖКХ): ' + it2);
    await js(`document.getElementById('it2').scrollIntoView({block:'center'})`); await sleep(300);
    const r2 = await js(`(()=>{const r=document.getElementById('it2').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
    w.webContents.sendInputEvent({ type: 'mouseDown', x: r2.x, y: r2.y, button: 'left', clickCount: 1 });
    w.webContents.sendInputEvent({ type: 'mouseUp', x: r2.x, y: r2.y, button: 'left', clickCount: 1 }); await sleep(600);
    fs.writeFileSync(path.join(OUT, 'select-zhkh.png'), (await w.webContents.capturePage()).toPNG());
    // тёмная тема
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); await sleep(200);
    await js(`document.documentElement.dataset.theme='dark'`); await sleep(200);
    w.webContents.sendInputEvent({ type: 'mouseDown', x: r2.x, y: r2.y, button: 'left', clickCount: 1 });
    w.webContents.sendInputEvent({ type: 'mouseUp', x: r2.x, y: r2.y, button: 'left', clickCount: 1 }); await sleep(600);
    fs.writeFileSync(path.join(OUT, 'select-zhkh-dark.png'), (await w.webContents.capturePage()).toPNG());
    ok(!errors.length, 'ошибок нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  } catch (e) { console.error(e); process.exitCode = 1; }
  app.exit(process.exitCode || 0);
});
