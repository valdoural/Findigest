'use strict';
/**
 * Проверка загрузки чеков из почты на тестовом IMAP-сервере (в памяти):
 *   1) HTML-чек от Магнита, 2) PDF-чек от ОФД (текстовый слой), 3) PDF-скан, 4) фото чека во вложении,
 *   5) рекламное письмо Магнита без чека, 6) письмо с темой «Кассовый чек» от неизвестного отправителя,
 *   7) постороннее письмо. Затем повторная проверка (дублей быть не должно) и разбор чеков в отчёте.
 * xvfb-run -a electron --no-sandbox test/mail-test.js
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-mail-'));
app.setPath('userData', DATA);
app.commandLine.appendSwitch('no-sandbox');
app.on('window-all-closed', () => {}); // служебные окна закрываются по ходу теста
const MailComposer = require('nodemailer/lib/mail-composer');
const hoodiecrow = require('hoodiecrow-imap');
const FX = path.join(__dirname, 'fixtures', 'mail');
const imapDate = x => { const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return `${String(x.getUTCDate()).padStart(2, '0')}-${M[x.getUTCMonth()]}-${x.getUTCFullYear()} 10:00:00 +0000`; };
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const raw = opts => new Promise((res, rej) => new MailComposer(opts).compile().build((e, m) => (e ? rej(e) : res(m.toString('binary')))));

const RECEIPT_HTML = `<html><body><h2>Магнит</h2><p>Кассовый чек. Приход</p><p>24.10.2026 19:05</p>
<table><tr><td>Бананы</td><td>1 x 189.00</td><td>189.00</td></tr><tr><td>Молоко 2,5% 930мл</td><td>1 x 89.00</td><td>89.00</td></tr>
<tr><td>Шоколад молочный</td><td>1 x 139.00</td><td>139.00</td></tr><tr><td><b>ИТОГ</b></td><td></td><td><b>417.00</b></td></tr></table>
<p>ФН 7380440800000001 ФД 4455 ФП 1122334455</p></body></html>`;
const OFD_HTML = `<html><body style="font-family:sans-serif;font-size:14px;width:380px"><h3>ООО «Агроторг» Пятёрочка</h3><div>Кассовый чек. Приход</div><div>23.10.2026 12:10</div><hr>
<div>Куриное филе 0,8 кг ..... 420.00</div><div>Хлеб нарезной ..... 52.90</div><div>Гречка 900 г ..... 109.99</div><hr><div><b>ИТОГ ..... 582.89</b></div><div>ФН 9960440300000002 ФД 777 ФП 3344556677</div></body></html>`;

async function pdfOf(html, asImage) {
  const w = new BrowserWindow({ show: !!asImage, width: 500, height: 700 }); // снимок экрана работает только у видимого окна
  w.webContents.on('did-fail-load', (e, c, dsc, u) => console.log('fail-load', c, dsc, u.slice(0, 80)));
  const f = path.join(DATA, 'tmp-' + Date.now() + '.html');
  fs.writeFileSync(f, '<meta charset="utf-8">' + html); await w.loadFile(f);
  if (asImage) { // «скан»: PDF, в котором только картинка, без текстового слоя
    fs.writeFileSync(path.join(DATA, 'scan.png'), (await w.webContents.capturePage()).toPNG());
    const f2 = f.replace('.html', '-scan.html');
    fs.writeFileSync(f2, '<img src="scan.png" style="width:100%">'); await w.loadFile(f2);
  }
  console.log('· pdf', !!asImage);
  const pdf = await w.webContents.printToPDF({ pageSize: 'A5', printBackground: true });
  w.destroy();
  return pdf;
}

process.on('unhandledRejection', e => { console.log('✗ ошибка теста:', e && e.stack || e); app.exit(1); });
app.whenReady().then(async () => {
  console.log('· старт');
  require('../src/main/paths').P.ensure();
  const D = require('../src/main/db/database');
  const settings = require('../src/main/config/settings'); settings.load();
  const secrets = require('../src/main/config/secrets'); await secrets.load();
  D.open();
  const d = (n) => new Date(Date.now() - n * 864e5);
  const msgs = [
    await raw({ from: 'Магнит <info@magnit-family.ru>', to: 'me@mail.ru', subject: 'Ваш электронный чек', date: d(2), html: RECEIPT_HTML }),
    await raw({ from: 'ОФД <noreply@ofd.ru>', to: 'me@mail.ru', subject: 'Чек от Пятёрочки', date: d(3), text: 'Чек во вложении', attachments: [{ filename: 'check.pdf', content: await pdfOf(OFD_HTML), contentType: 'application/pdf' }] }),
    await raw({ from: 'ОФД <noreply@ofd.ru>', to: 'me@mail.ru', subject: 'Чек (скан)', date: d(4), text: 'Скан чека', attachments: [{ filename: 'scan.pdf', content: await pdfOf(OFD_HTML, true), contentType: 'application/pdf' }] }),
    await raw({ from: 'Лента <check@lenta.com>', to: 'me@mail.ru', subject: 'Кассовый чек', date: d(5), text: 'Фото чека', attachments: [{ filename: 'lenta.jpg', content: fs.readFileSync(path.join(FX, 'lenta-photo.jpg')), contentType: 'image/jpeg' }] }),
    await raw({ from: 'Магнит <info@magnit-family.ru>', to: 'me@mail.ru', subject: 'Скидки недели!', date: d(6), html: '<p>Только до воскресенья — скидки на фрукты. Приходите!</p>' }),
    await raw({ from: 'Друг <friend@mail.ru>', to: 'me@mail.ru', subject: 'Привет', date: d(1), text: 'Как дела? Потом расскажу.' }),
    await raw({ from: 'Магнит <info@magnit-family.ru>', to: 'me@mail.ru', subject: 'Старый чек', date: d(200), html: RECEIPT_HTML.replace('24.10.2026', '01.03.2026') }),
  ];
  const server = hoodiecrow({ plugins: ['id', 'idle', 'unselect', 'enable', 'condstore', 'special-use', 'literalplus'], id: { name: 'test' },
    users: { 'me@mail.ru': { password: 'app-pass' } },
    storage: { INBOX: { messages: msgs.map((r, i) => ({ raw: r, internaldate: imapDate(d([2, 3, 4, 5, 6, 1, 200][i])), flags: [] })) } } });
  await new Promise(r => server.listen(11143, r));
  console.log('· IMAP-сервер запущен, писем', msgs.length);

  settings.patch('mail', { enabled: true, user: 'me@mail.ru', host: '127.0.0.1', port: 11143, secure: false, depthDays: 90, subjectSearch: true });
  await secrets.set('mail_password', 'app-pass');
  const mail = require('../src/main/connectors/mail');
  const render = require('../src/main/tools/render');

  console.log('· проверка входа…');
  const t = await mail.test();
  ok(t.ok && t.total === 7, `вход и поиск: писем ${t.total}, похожих на чеки за 90 дней ${t.receipts90d}`);

  console.log('· загрузка чеков…');
  const r1 = await mail.fetchReceipts({ render });
  ok(r1.receipts === 4, `первая проверка: писем ${r1.checked}, чеков ${r1.receipts}, без чека ${r1.skipped}, ошибок ${r1.errors}`);
  const arc = D.db.prepare("SELECT json FROM archive WHERE source='mail'").all().map(x => JSON.parse(x.json));
  const by = n => arc.find(e => e.name.includes(n));
  const html = by('Ваш электронный чек'), pdf = by('check.pdf'), scan = by('scan.pdf'), photo = by('lenta.jpg');
  ok(html && /Бананы/.test(html.text) && html.mstore === 'Магнит', 'HTML-чек Магнита → текст, магазин определён по отправителю');
  ok(pdf && /Куриное филе/.test(pdf.text || ''), 'PDF-чек ОФД → текст из текстового слоя');
  ok(scan && !scan.text && D.db.prepare("SELECT COUNT(*) n FROM archive_files WHERE archive_id=? AND field='pages'").get(scan.id).n >= 1, 'PDF-скан → страницы картинками для ИИ');
  ok(photo && D.db.prepare("SELECT COUNT(*) n FROM archive_files WHERE archive_id=? AND field='img'").get(photo.id).n === 1, 'фото чека из вложения → картинка');
  ok(!arc.some(e => /Скидки|Привет|Старый/.test(e.name)), 'реклама, личное письмо и письмо старше 90 дней не попали в архив');
  ok(html.maildate && /^\d{4}-\d{2}-\d{2}$/.test(html.maildate), 'дата письма сохранена как запасная дата покупки');

  const r2 = await mail.fetchReceipts({ render });
  ok(r2.checked === 0 && r2.receipts === 0, `повторная проверка: новых писем ${r2.checked} — дублей нет`);
  ok(mail.pendingCount() === 4, 'неразобранных чеков из почты: ' + mail.pendingCount());

  // разбор в отчёте (без ИИ: текстовые чеки разбираются локально, фото и скан ждут ИИ)
  settings.patch('firstRunDone', true);
  require('../src/main/ipc').register({});
  const w = new BrowserWindow({ show: true, width: 1320, height: 900, webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload', 'preload.js'), contextIsolation: true, sandbox: true } });
  const errors = [];
  w.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message); });
  await w.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'digest', 'index.html'), { hash: 'sheet6' });
  await w.webContents.executeJavaScript(`sessionStorage.setItem('fd_autoparse','1');location.reload();`);
  await new Promise(r => setTimeout(r, 9000));

  const rcp = (JSON.parse((D.db.prepare("SELECT json FROM docs WHERE id='rcp'").get() || { json: '{"v":[]}' }).json).v || []);
  const st = D.db.prepare("SELECT status, COUNT(*) n FROM archive WHERE source='mail' GROUP BY status").all();
  console.log('· позиции:', JSON.stringify(rcp.map(x => [x.d, x.st, x.n, x.s])));
  ok(rcp.some(x => /^Бананы/.test(x.n) && x.st === 'Магнит' && x.d === '2026-10-24') && rcp.some(x => /Куриное/.test(x.n)), `авторазбор в отчёте: позиций ${rcp.length}; статусы ${JSON.stringify(st)}`);
  ok(D.db.prepare('SELECT COUNT(*) n FROM receipt_items').get().n === rcp.length, 'позиции чеков записаны и в таблицу receipt_items');
  fs.writeFileSync(path.join(os.tmpdir(), 'fd-mail-shot.png'), (await w.webContents.capturePage()).toPNG());
  ok(!errors.length, 'ошибок в отчёте нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  server.close();
  app.exit(process.exitCode || 0);
});
