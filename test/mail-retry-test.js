'use strict';
/**
 * Письма, которые раньше «не дали чека», и чеки, удалённые из архива: «Сохранить и проверить почту» (retry) перечитывает их.
 *   а) чек Ленты, помеченный раньше «в письме нет чека» (старое распознавание), — суммы целыми рублями, «Чек №»;
 *   б) чек только ссылкой «Посмотреть чек» на сайт ОФД (локальный сервер);
 *   в) письмо Ленты «Ваш заказ» без стандартных реквизитов — в архив для разбора ИИ;
 *   г) реклама Ленты — в архив не попадает;
 *   д) чек загружен, затем удалён из архива — при проверке возвращается.
 * xvfb-run -a electron --no-sandbox test/mail-retry-test.js
 */
const { app } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'fd-mr-')));
app.commandLine.appendSwitch('no-sandbox'); app.on('window-all-closed', () => {});
const MailComposer = require('nodemailer/lib/mail-composer');
const hoodiecrow = require('hoodiecrow-imap');
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const raw = opts => new Promise((res, rej) => new MailComposer(opts).compile().build((e, m) => (e ? rej(e) : res(m.toString('binary')))));
const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const imapDate = x => `${String(x.getUTCDate()).padStart(2, '0')}-${M[x.getUTCMonth()]}-${x.getUTCFullYear()} 10:00:00 +0000`;
const ago = n => new Date(Date.now() - n * 864e5);

process.on('unhandledRejection', e => { console.log('✗ ошибка теста:', e && e.stack || e); app.exit(1); });
app.whenReady().then(async () => {
  require('../src/main/paths').P.ensure();
  const D = require('../src/main/db/database');
  const settings = require('../src/main/config/settings'); settings.load();
  const secrets = require('../src/main/config/secrets'); await secrets.load();
  D.open();
  // страница ОФД с чеком
  const web = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end('<html><body><h1>Кассовый чек</h1><div>ООО «Лента»</div><div>Кефир 1% ... 89,90</div><div>Батон ... 45,00</div><div>ИТОГ: 134,90</div><div>ФН 9999078900001234 ФД 77 ФП 123</div></body></html>'); });
  await new Promise(r => web.listen(0, '127.0.0.1', r));
  const LINK = `http://127.0.0.1:${web.address().port}/ofd/check?fn=9999078900001234&fd=77`;
  const L = [
    { id: '<a-lenta@test>', from: 'Лента <check@lenta.com>', subject: 'Ваш чек', html: '<p>Спасибо за покупку!</p><p>Чек № 4512 от 27.10.2026</p><table><tr><td>Сыр российский</td><td>412 ₽</td></tr><tr><td>Яблоки</td><td>160 ₽</td></tr><tr><td>Итого:</td><td>572 ₽</td></tr></table>', d: 1 },
    { id: '<b-link@test>', from: 'Лента <check@lenta.com>', subject: 'Электронный чек', html: `<p>Ваш чек сформирован.</p><p><a href="${LINK}">Посмотреть чек</a></p>`, d: 2 },
    { id: '<c-order@test>', from: 'Лента <check@lenta.com>', subject: 'Ваш заказ доставлен', html: '<p>Заказ 778 доставлен. Молоко 99,90; Хлеб 64,00. Сумма заказа 163,90</p>', d: 3 },
    { id: '<d-promo@test>', from: 'Лента <check@lenta.com>', subject: 'Скидки недели', html: '<p>Только до воскресенья: сыр за 199 ₽!</p>', d: 4 },
  ];
  const msgs = [];
  for (const x of L) msgs.push({ raw: await raw({ messageId: x.id, from: x.from, to: 'me@mail.ru', subject: x.subject, date: ago(x.d), html: x.html }), internaldate: imapDate(ago(x.d)), flags: [] });
  const server = hoodiecrow({ plugins: ['id', 'idle', 'unselect', 'enable', 'condstore', 'special-use', 'literalplus'], id: { name: 'test' },
    users: { 'me@mail.ru': { password: 'p' } }, storage: { INBOX: { messages: msgs } } });
  await new Promise(r => server.listen(11145, r));
  settings.patch('mail', { enabled: true, provider: 'custom', user: 'me@mail.ru', host: '127.0.0.1', port: 11145, secure: false, depthDays: 90, subjectSearch: false,
    senders: { 'Лента': 'check@lenta.com' }, lastCheck: new Date().toISOString(), extractV: require('../src/main/connectors/mail').EXTRACT_V });
  await secrets.set('mail_password', 'p');
  // как у пользователя: письма уже были проверены старой версией и помечены «в письме нет чека»
  const mark = D.db.prepare('INSERT INTO mail_seen(key,folder,uid,date,from_addr,subject,archive_ids,status,note,created) VALUES(?,?,?,?,?,?,?,?,?,?)');
  for (const x of L) mark.run(x.id, 'INBOX', 0, ago(x.d).toISOString(), 'check@lenta.com', x.subject, '[]', 'no_receipt', 'в письме нет чека', new Date().toISOString());
  const mail = require('../src/main/connectors/mail');
  const render = require('../src/main/tools/render');

  const t = await mail.test();
  ok(t.receipts90d === 4 && t.letters.length === 4 && t.letters.every(l => l.status === 'no_receipt' && l.shop === 'Лента'), `проверка видит письма и их прошлый итог: ${t.letters.map(l => l.status).join(', ')}`);
  const r0 = await mail.fetchReceipts({ render });
  ok(r0.checked === 0, 'обычная фоновая проверка такие письма не трогает (не дёргает почту каждые 30 минут)');
  const r1 = await mail.fetchReceipts({ render, retry: true });
  const arc = () => D.db.prepare("SELECT json FROM archive WHERE source='mail'").all().map(x => JSON.parse(x.json));
  const a1 = arc();
  console.log('   письма:', JSON.stringify(r1.letters.map(l => [l.subject, l.status, l.note])));
  ok(r1.checked === 4 && r1.receipts === 3, `«Сохранить и проверить»: перечитано ${r1.checked}, чеков ${r1.receipts}`);
  ok(a1.some(e => /Сыр российский/.test(e.text || '') && e.mstore === 'Лента'), 'а) чек с суммами целыми рублями и «Чек №» распознан');
  ok(a1.some(e => e.link === LINK && /Кефир/.test(e.text || '')), 'б) чек по ссылке: страница ОФД открыта, текст чека в архиве');
  ok(a1.some(e => e.unsure && /Заказ 778/.test(e.text || '')), 'в) письмо магазина «Ваш заказ» — в архиве для разбора');
  ok(!a1.some(e => /Скидки/.test(e.name)) && r1.letters.find(l => /Скидки/.test(l.subject)).status === 'no_receipt', 'г) реклама — не в архиве, причина записана: ' + r1.letters.find(l => /Скидки/.test(l.subject)).note);

  // д) чек удалили из архива — при проверке он возвращается
  const lent = a1.find(e => /Сыр российский/.test(e.text || ''));
  D.db.prepare('DELETE FROM archive WHERE id=?').run(lent.id);
  const r2 = await mail.fetchReceipts({ render, retry: true });
  ok(r2.receipts === 1 && arc().some(e => e.id === lent.id), 'д) удалённый из архива чек загружен снова при проверке');
  const r3 = await mail.fetchReceipts({ render, retry: true });
  ok(r3.receipts === 0 && arc().length === 3, 'повторная проверка — без дублей');

  // новая версия распознавания: письма «без чека» перечитываются и без кнопки
  settings.patch('mail', { extractV: 1 });
  const r4 = await mail.fetchReceipts({ render });
  ok(r4.checked === 1 && settings.get().mail.extractV === mail.EXTRACT_V, 'после обновления распознавания письма без чека проверяются заново автоматически');
  server.close(); web.close();
  app.exit(process.exitCode || 0);
});
