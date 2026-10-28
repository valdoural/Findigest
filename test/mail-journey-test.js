'use strict';
/**
 * Путь чека из почты до отчёта, глазами пользователя:
 *   1) добавил магазин «Лента» → «Сохранить и проверить почту» → чеки Ленты (и старые, за глубину поиска) в архиве,
 *      разобраны и уже в «Продуктах» (база: archive, rcp, receipt_items); отдельной кнопки «Загрузить чеки» нет;
 *   2) пока программа открыта, приходит новое письмо → фоновая проверка → чек разобран без перезагрузки страницы,
 *      подсказка «Новый чек из почты: Лента · сумма»;
 *   3) фоновая проверка без новых писем — тихая; повторная — без дублей.
 * xvfb-run -a electron --no-sandbox test/mail-journey-test.js <папка для снимков>
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'fd-mj-')));
app.commandLine.appendSwitch('no-sandbox'); app.on('window-all-closed', () => {});
const OUT = process.argv[process.argv.length - 1];
const MailComposer = require('nodemailer/lib/mail-composer');
const hoodiecrow = require('hoodiecrow-imap');
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const raw = opts => new Promise((res, rej) => new MailComposer(opts).compile().build((e, m) => (e ? rej(e) : res(m.toString('binary')))));
const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const imapDate = x => `${String(x.getUTCDate()).padStart(2, '0')}-${M[x.getUTCMonth()]}-${x.getUTCFullYear()} 10:00:00 +0000`;
const ago = n => new Date(Date.now() - n * 864e5);
const dmy = x => `${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}.${x.getFullYear()}`;
const receipt = (shop, when, rows) => `<html><body><h2>${shop}</h2><p>Кассовый чек. Приход</p><p>${dmy(when)} 18:40</p><table>${rows.map(([n, s]) => `<tr><td>${n}</td><td>1 x ${s.toFixed(2)}</td><td>${s.toFixed(2)}</td></tr>`).join('')}<tr><td><b>ИТОГ</b></td><td></td><td><b>${rows.reduce((a, r) => a + r[1], 0).toFixed(2)}</b></td></tr></table><p>ФН 7380440800000009 ФД 1 ФП 2</p></body></html>`;

process.on('unhandledRejection', e => { console.log('✗ ошибка теста:', e && e.stack || e); app.exit(1); });
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  require('../src/main/paths').P.ensure();
  const D = require('../src/main/db/database');
  const settings = require('../src/main/config/settings'); settings.load();
  const secrets = require('../src/main/config/secrets'); await secrets.load();
  D.open();
  const msgs = [
    [await raw({ from: 'Лента <check@lenta.com>', to: 'me@mail.ru', subject: 'Ваш чек', date: ago(1), html: receipt('Лента', ago(1), [['Сыр российский', 412.5], ['Яблоки 1 кг', 159.9]]) }), 1],
    [await raw({ from: 'Лента <check@lenta.com>', to: 'me@mail.ru', subject: 'Ваш чек', date: ago(20), html: receipt('Лента', ago(20), [['Кофе молотый', 649]]) }), 20],
    [await raw({ from: 'Друг <friend@mail.ru>', to: 'me@mail.ru', subject: 'Привет', date: ago(1), text: 'Как дела?' }), 1],
  ];
  const server = hoodiecrow({ plugins: ['id', 'idle', 'unselect', 'enable', 'condstore', 'special-use', 'literalplus'], id: { name: 'test' },
    users: { 'me@mail.ru': { password: 'app-pass' } },
    storage: { INBOX: { messages: msgs.map(([r, n]) => ({ raw: r, internaldate: imapDate(ago(n)), flags: [] })) } } });
  await new Promise(r => server.listen(11144, r));
  // почта уже была настроена раньше (Магнит), последняя проверка — сегодня; Ленты в списке ещё нет
  settings.patch('mail', { enabled: true, provider: 'custom', user: 'me@mail.ru', host: '127.0.0.1', port: 11144, secure: false, depthDays: 90, subjectSearch: false, autoParse: true,
    senders: { 'Магнит': 'info@magnit-family.ru' }, lastCheck: new Date().toISOString() });
  settings.patch('firstRunDone', true);
  await secrets.set('mail_password', 'app-pass');
  require('../src/main/ipc').register({});
  const service = require('../src/main/digest/service');

  const w = new BrowserWindow({ show: true, width: 1440, height: 900, webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload', 'preload.js'), contextIsolation: true, sandbox: true } });
  const errors = []; w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message); });
  await w.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'digest', 'index.html'), { hash: 'sheet6' }); await sleep(3500);
  const js = s => w.webContents.executeJavaScript(s);
  const shot = n => w.webContents.capturePage().then(i => fs.writeFileSync(path.join(OUT, n + '.png'), i.toPNG()));
  const rcp = () => JSON.parse((D.db.prepare("SELECT json FROM docs WHERE id='rcp'").get() || { json: '{"v":[]}' }).json).v || [];

  /* 1. новый магазин → «Сохранить и проверить почту» */
  await js(`window.FD_openConnections('mail')`); await sleep(500);
  ok(await js(`!document.getElementById('mail-fetch')`), 'отдельной кнопки «Загрузить чеки сейчас» нет — одна кнопка на весь путь');
  ok(await js(`document.querySelectorAll('#cnp .cn-flow li').length === 3 && !!document.getElementById('mail-poll')`), 'в «Почте» показан путь чека в три шага и частота проверки');
  await js(`document.getElementById('mail-add').click()`); await sleep(100);
  await js(`(()=>{const r=[...document.querySelectorAll('#cnp .cn-snd')].pop().querySelectorAll('input');r[0].value='Лента';r[1].value='check@lenta.com';document.getElementById('mail-poll').value='15';document.getElementById('mail-prov').value='custom';document.getElementById('mail-host').value='127.0.0.1';document.getElementById('mail-port').value='11144'})()`);
  await js(`document.getElementById('mail-save').click()`);
  let m = '';
  for (let i = 0; i < 80; i++) { await sleep(250); m = await js(`(document.getElementById('mail-msg')||{}).textContent||''`); if (/добавлено|Новых нет|не удалась|Ошибка/.test(m)) break; }
  console.log('  ', m);
  const after1 = rcp(); console.log('   rcp:', JSON.stringify(after1.map(x => [x.d, x.st, x.n, x.s])));
  ok(/Новых: 2/.test(m) && /добавлено чеков: 2 \(Лента\)/.test(m), '«Сохранить и проверить почту»: найдены оба чека Ленты (и 20-дневный — новый магазин ищется на всю глубину), разобраны');
  ok(after1.filter(x => x.st === 'Лента').length === 3 && after1.some(x => /Сыр российский/.test(x.n) && x.s === 412.5) && after1.every(x => x.s < 1000), `позиции Ленты в «Продуктах» с верными суммами (копейки не склеиваются): ${after1.length}`);
  ok(D.db.prepare("SELECT COUNT(*) n FROM archive WHERE source='mail' AND status='parsed'").get().n === 2 && D.db.prepare('SELECT COUNT(*) n FROM receipt_items').get().n === after1.length, 'в базе: чеки в архиве со статусом «разобран», позиции в receipt_items');
  ok(settings.get().mail.pollMinutes === 15 && settings.get().mail.senders['Лента'] === 'check@lenta.com', 'настройки сохранены: Лента и проверка каждые 15 минут');
  await shot('mail-tab');
  await js(`window.FD_closeConnections()`); await sleep(400);

  /* 2. новое письмо, пока программа открыта → фоновая проверка → чек в отчёте без перезагрузки */
  await js(`window.__noReload = 1`);
  const today = new Date();
  const mb = server.getMailbox('INBOX');
  server.appendMessage(mb, [], imapDate(today), await raw({ from: 'Лента <check@lenta.com>', to: 'me@mail.ru', subject: 'Ваш чек', date: today, html: receipt('Лента', today, [['Молоко 3,2%', 99.9], ['Хлеб бородинский', 64]]) }));
  await service.refresh({ only: 'mail', reason: 'mail-poll' });
  let toast = '';
  for (let i = 0; i < 60; i++) { await sleep(250); toast = await js(`(()=>{const t=document.querySelector('.fd-toast');return t&&!t.hidden?t.textContent:''})()`); if (/Новый чек/.test(toast)) break; }
  console.log('  ', toast);
  const after2 = rcp();
  ok(await js(`window.__noReload === 1`), 'отчёт не перезагружался');
  ok(/Новый чек из почты: Лента · \d\d\.\d\d · 163,9|Новый чек из почты: Лента · \d\d\.\d\d · 164/.test(toast.replace(/\s/g, ' ')) && /Показать/.test(toast), 'подсказка «Новый чек из почты: Лента · дата · сумма» с кнопкой «Показать»');
  ok(after2.length === after1.length + 2 && after2.some(x => /Хлеб бородинский/.test(x.n)), 'покупки из нового чека добавлены в «Продукты» и базу');
  await shot('new-receipt-toast');
  await js(`[...document.querySelectorAll('.fd-toast button')].find(b=>b.textContent==='Показать').click()`); await sleep(900);
  ok(await js(`location.hash.includes('sheet6') || document.querySelector('.tabs [data-s="sheet6"]').getAttribute('aria-selected')==='true'`), '«Показать» открывает «Продукты» и архив чеков');
  await shot('receipt-archive');

  /* 3. тихая фоновая проверка и отсутствие дублей */
  await js(`document.querySelector('.fd-toast').hidden = true`);
  await service.refresh({ only: 'mail', reason: 'mail-poll' }); await sleep(1200);
  ok(await js(`document.querySelector('.fd-toast').hidden`), 'фоновая проверка без новых писем ничего не показывает');
  ok(rcp().length === after2.length && D.db.prepare("SELECT COUNT(*) n FROM archive WHERE source='mail'").get().n === 3, 'повторная проверка — без дублей');
  ok(!errors.length, 'ошибок нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  server.close();
  app.exit(process.exitCode || 0);
});
