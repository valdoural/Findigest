'use strict';
/**
 * Чеки, которые почтовик положил не во «Входящие» («Рассылки», «Покупки», ярлык Gmail), и разные письма с одинаковым Message-ID:
 * раньше такие чеки не попадали в архив. Корзина и спам не просматриваются.
 * xvfb-run -a electron --no-sandbox test/mail-folders-test.js
 */
const { app } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'fd-mf-')));
app.commandLine.appendSwitch('no-sandbox'); app.on('window-all-closed', () => {});
const MailComposer = require('nodemailer/lib/mail-composer');
const hoodiecrow = require('hoodiecrow-imap');
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
const raw = opts => new Promise((res, rej) => new MailComposer(opts).compile().build((e, m) => (e ? rej(e) : res(m.toString('binary')))));
const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const imapDate = x => `${String(x.getUTCDate()).padStart(2, '0')}-${M[x.getUTCMonth()]}-${x.getUTCFullYear()} 10:00:00 +0000`;
const ago = n => new Date(Date.now() - n * 864e5);
const dmy = x => `${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}.${x.getFullYear()}`;
const receipt = (when, rows) => `<html><body><h2>Лента</h2><p>Кассовый чек. Приход</p><p>${dmy(when)} 18:40</p><table>${rows.map(([n, s]) => `<tr><td>${n}</td><td>1 x ${s.toFixed(2)}</td><td>${s.toFixed(2)}</td></tr>`).join('')}<tr><td><b>ИТОГ</b></td><td></td><td><b>${rows.reduce((a, r) => a + r[1], 0).toFixed(2)}</b></td></tr></table><p>ФН 7380440800000009 ФД 1 ФП 2</p></body></html>`;
const letter = async (n, rows, mid) => ({ raw: await raw({ from: 'Лента <check@lenta.com>', to: 'me@mail.ru', subject: 'Ваш чек', date: ago(n), messageId: mid, html: receipt(ago(n), rows) }), internaldate: imapDate(ago(n)), flags: [] });

process.on('unhandledRejection', e => { console.log('✗ ошибка теста:', e && e.stack || e); app.exit(1); });
app.whenReady().then(async () => {
  require('../src/main/paths').P.ensure();
  const D = require('../src/main/db/database');
  const settings = require('../src/main/config/settings'); settings.load();
  const secrets = require('../src/main/config/secrets'); await secrets.load();
  D.open();
  const server = hoodiecrow({ plugins: ['id', 'idle', 'unselect', 'enable', 'condstore', 'special-use', 'literalplus'], id: { name: 'test' },
    users: { 'me@mail.ru': { password: 'app-pass' } },
    storage: {
      INBOX: { messages: [await letter(9, [['Кофе молотый', 649]], '<same@lenta>')] },
      '': { separator: '/', folders: {
        'Newsletters': { messages: [await letter(2, [['Сыр российский', 412.5]], '<a1@lenta>'), await letter(1, [['Молоко', 99.9]], '<same@lenta>')] },
        'Deleted': { 'special-use': '\\Trash', messages: [await letter(3, [['Удалённое', 1000]], '<trash@lenta>')] },
        'Bulk': { 'special-use': '\\Junk', messages: [await letter(4, [['Спам', 2000]], '<spam@lenta>')] },
      } },
    } });
  await new Promise(r => server.listen(11145, r));
  settings.patch('mail', { enabled: true, provider: 'custom', user: 'me@mail.ru', host: '127.0.0.1', port: 11145, secure: false, depthDays: 90, subjectSearch: false,
    senders: { 'Лента': 'check@lenta.com' }, lastCheck: null, extractV: 3 });
  await secrets.set('mail_password', 'app-pass');
  const mail = require('../src/main/connectors/mail');

  const t = await mail.test();
  console.log('   ', JSON.stringify(t.folders), t.letters.map(l => l.folder + ' ' + l.date.slice(0, 10)).join(' | '));
  ok(t.receipts90d === 3 && t.folders['Newsletters'] === 2 && !t.folders['Deleted'] && !t.folders['Bulk'], 'проверка видит письма во «Входящих» и в «Рассылках», корзину и спам — нет');
  const r = await mail.fetchReceipts({});
  const rows = D.db.prepare("SELECT id, store, date, total FROM archive WHERE source='mail' ORDER BY date").all();
  console.log('   ', JSON.stringify(rows));
  ok(r.receipts === 3 && rows.length === 3, `в архиве все 3 чека (найдено ${r.receipts}, в базе ${rows.length})`);
  const js = D.db.prepare("SELECT json FROM archive WHERE source='mail'").all().map(x => x.json).join(' ');
  ok(/Молоко/.test(js) && /Кофе молотый/.test(js) && new Set(rows.map(x => x.id)).size === 3, 'два письма с одинаковым Message-ID — два разных чека, старый не перезаписан');
  const r2 = await mail.fetchReceipts({});
  ok(r2.checked === 0 && D.db.prepare("SELECT COUNT(*) n FROM archive WHERE source='mail'").get().n === 3, 'повторная проверка — без дублей');
  settings.patch('mail', { allFolders: false });
  const t2 = await mail.test();
  ok(t2.receipts90d === 1, 'если отключить «все папки» — только «Входящие»');
  server.close();
  app.exit(process.exitCode || 0);
});
