'use strict';
/**
 * Почта по IMAP (по умолчанию mail.ru). Пароль — «пароль для внешних приложений», хранится в secrets.json.
 *
 * test()          — вход и подсчёт писем-чеков.
 * fetchReceipts() — ищет письма по адресам отправителей магазинов (и, если включено, по теме «чек»),
 *                   превращает вложения и тело письма в записи архива чеков. Каждое письмо обрабатывается
 *                   один раз (таблица mail_seen), поэтому повторная проверка не создаёт дублей.
 * Письма в почте не меняются и не помечаются прочитанными.
 */
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const settings = require('../config/settings');
const secrets = require('../config/secrets');
const D = require('../db/database');
const store = require('../db/store');
const { extract } = require('./mail-extract');
const log = require('../log');

const PRESETS = {
  mailru: { host: 'imap.mail.ru', port: 993, title: 'Mail.ru (а также @inbox.ru, @list.ru, @bk.ru)', passUrl: 'https://account.mail.ru/user/2-step-auth/passwords/' },
  yandex: { host: 'imap.yandex.ru', port: 993, title: 'Яндекс Почта', passUrl: 'https://id.yandex.ru/security/app-passwords' },
  gmail: { host: 'imap.gmail.com', port: 993, title: 'Gmail', passUrl: 'https://myaccount.google.com/apppasswords' },
  custom: { host: '', port: 993, title: 'Другой сервер IMAP', passUrl: '' },
};
const SUBJECTS = ['кассовый чек', 'электронный чек', 'чек по заказу', 'ваш чек'];
const MAX_SIZE = 15 * 1024 * 1024;

function client() {
  const m = settings.get().mail;
  const pass = secrets.get('mail_password');
  if (!m.user || !pass) throw Object.assign(new Error('Укажите адрес почты и пароль приложения'), { code: 'auth' });
  return new ImapFlow({ host: m.host, port: m.port, secure: m.secure !== false, auth: { user: m.user, pass }, logger: false, socketTimeout: 60000 });
}

function friendly(e) {
  const t = String(e.responseText || e.message || '');
  if (e.code === 'auth' || /auth|login|credentials|invalid|password/i.test(t)) return Object.assign(new Error('Почта не приняла логин или пароль приложения'), { code: 'auth' });
  return Object.assign(new Error('Не удалось подключиться к почте: ' + t.slice(0, 160)), { code: 'network' });
}

/** Отправители: «магазин → адрес». Адрес без @ (например «ofd») ищется как часть адреса. Магазин «ОФД…» не подставляется в чек. */
function senders() {
  return Object.entries(settings.get().mail.senders || {})
    .map(([shop, addr]) => ({ shop: /^офд/i.test(shop.trim()) ? '' : shop.trim(), addr: String(addr || '').trim().toLowerCase() }))
    .filter(s => s.addr);
}
const shopFor = from => { const f = (from || '').toLowerCase(); const s = senders().find(x => f.includes(x.addr)); return s ? s.shop : ''; };

async function searchUids(c, since) {
  const set = new Set();
  for (const s of senders()) for (const u of (await c.search({ from: s.addr, since }, { uid: true })) || []) set.add(u);
  if (settings.get().mail.subjectSearch) {
    let unsupported = false;
    for (const subj of SUBJECTS) {
      const r = await c.search({ subject: subj, since }, { uid: true });
      if (r === false) { unsupported = true; break; } // сервер не ищет по русским словам — проверим тему сами
      for (const u of r || []) set.add(u);
    }
    if (unsupported) {
      const recent = ((await c.search({ since }, { uid: true })) || []).slice(-2000);
      const re = new RegExp(SUBJECTS.join('|'), 'i');
      if (recent.length) for await (const m of c.fetch(recent.join(','), { uid: true, envelope: true }, { uid: true })) if (re.test((m.envelope && m.envelope.subject) || '')) set.add(m.uid);
    }
  }
  return [...set].sort((a, b) => a - b);
}

async function test() {
  const m = settings.get().mail;
  const c = client();
  try {
    await c.connect();
    const lock = await c.getMailboxLock(m.folder || 'INBOX');
    try {
      const uids = await searchUids(c, new Date(Date.now() - 90 * 864e5));
      return { ok: true, total: c.mailbox.exists, receipts90d: uids.length, senders: senders().length };
    } finally { lock.release(); }
  } catch (e) { throw friendly(e); }
  finally { try { await c.logout(); } catch (_) { /* уже закрыто */ } }
}

let running = null;
/** Загрузить новые чеки из почты в архив. */
function fetchReceipts({ render } = {}) {
  if (running) return running;
  running = (async () => {
    const m = settings.get().mail;
    const started = new Date().toISOString();
    const last = m.lastCheck ? new Date(m.lastCheck) : null;
    const since = last ? new Date(last.getTime() - 3 * 864e5) : new Date(Date.now() - (+m.depthDays || 90) * 864e5);
    const res = { checked: 0, imported: 0, receipts: 0, skipped: 0, errors: 0, ids: [] };
    const c = client();
    try {
      await c.connect();
      const folder = m.folder || 'INBOX';
      const lock = await c.getMailboxLock(folder);
      try {
        const uids = await searchUids(c, since);
        const seen = D.db.prepare('SELECT 1 FROM mail_seen WHERE key=?');
        const mark = D.db.prepare(`INSERT OR REPLACE INTO mail_seen(key,folder,uid,date,from_addr,subject,archive_ids,status,note,created) VALUES(?,?,?,?,?,?,?,?,?,?)`);
        for (const uid of uids) {
          const env = await c.fetchOne(uid, { uid: true, envelope: true, size: true }, { uid: true });
          if (!env) continue;
          const key = (env.envelope && env.envelope.messageId) || `${folder}:${c.mailbox.uidValidity}:${uid}`;
          if (seen.get(key)) continue;
          res.checked++;
          if (env.size > MAX_SIZE) { mark.run(key, folder, uid, null, '', (env.envelope || {}).subject || '', '[]', 'skipped', 'письмо больше 15 МБ', new Date().toISOString()); res.skipped++; continue; }
          try {
            const msg = await c.fetchOne(uid, { uid: true, source: true }, { uid: true });
            const parsed = await simpleParser(msg.source);
            const from = ((parsed.from && parsed.from.value && parsed.from.value[0]) || {}).address || '';
            const r = await extract(parsed, { key, store: shopFor(from), render });
            for (const e of r.entries) { store.archivePut(e); res.ids.push(e.id); }
            mark.run(key, folder, uid, parsed.date ? new Date(parsed.date).toISOString() : null, from, r.subject, JSON.stringify(r.entries.map(e => e.id)),
              r.entries.length ? 'imported' : 'no_receipt', r.note || null, new Date().toISOString());
            if (r.entries.length) { res.imported++; res.receipts += r.entries.length; } else res.skipped++;
          } catch (x) {
            res.errors++;
            log.warn('Почта: письмо', uid, x.message);
            mark.run(key, folder, uid, null, '', (env.envelope || {}).subject || '', '[]', 'error', x.message.slice(0, 200), new Date().toISOString());
          }
        }
      } finally { lock.release(); }
      settings.patch('mail', { lastCheck: new Date().toISOString(), lastResult: { at: new Date().toISOString(), ...res, ids: undefined } });
      D.db.prepare('INSERT INTO sync_log(source,started,finished,status,message) VALUES(?,?,?,?,?)')
        .run('mail', started, new Date().toISOString(), 'ok', `писем ${res.checked}, чеков ${res.receipts}, без чека ${res.skipped}, ошибок ${res.errors}`);
      log.info(`Почта: новых писем ${res.checked}, чеков загружено ${res.receipts}`);
      return res;
    } catch (e) {
      const f = e.code && /auth|network/.test(e.code) ? e : friendly(e);
      D.db.prepare('INSERT INTO sync_log(source,started,finished,status,message) VALUES(?,?,?,?,?)').run('mail', started, new Date().toISOString(), 'error', f.message);
      throw f;
    } finally {
      try { await c.logout(); } catch (_) { /* уже закрыто */ }
      running = null;
    }
  })();
  return running;
}

/** Загружено из почты и ещё не разобрано. */
function pendingCount() {
  try { return D.db.prepare("SELECT COUNT(*) n FROM archive WHERE source='mail' AND kind='receipt' AND status<>'parsed'").get().n; } catch (_) { return 0; }
}

module.exports = { test, fetchReceipts, pendingCount, PRESETS, senders };
