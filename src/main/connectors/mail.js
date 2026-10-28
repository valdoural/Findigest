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
// версия распознавания: при её росте письма, где раньше «чека не нашлось» или была ошибка, проверяются заново
const EXTRACT_V = 2;

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
const senderOf = from => { const f = (from || '').toLowerCase(); return senders().find(x => f.includes(x.addr)) || null; };
const shopFor = from => { const s = senderOf(from); return s ? s.shop : ''; };

/** Страница чека по ссылке из письма (сайт ОФД / ФНС): только текст, до 2 МБ, 20 секунд. */
async function fetchText(url) {
  const { net } = require('electron');
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 20000);
  try {
    const res = await net.fetch(url, { signal: ac.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 FinDigest' } });
    if (!res.ok) throw new Error('страница ответила ' + res.status);
    const text = await res.text();
    return text.slice(0, 2e6);
  } finally { clearTimeout(t); }
}

/** Письма, где чек не нашли или была ошибка, — снова в очередь (кроме слишком больших). */
function forgetFailed() {
  let n = D.db.prepare("DELETE FROM mail_seen WHERE status IN ('no_receipt','error')").run().changes;
  // «загружено», но записей в архиве уже нет (чек удалили) — тоже перечитать
  const has = D.db.prepare('SELECT 1 FROM archive WHERE id=?'), del = D.db.prepare('DELETE FROM mail_seen WHERE key=?');
  for (const r of D.db.prepare("SELECT key, archive_ids FROM mail_seen WHERE status='imported'").all()) {
    let ids = []; try { ids = JSON.parse(r.archive_ids || '[]'); } catch (_) { /* старая запись */ }
    if (!ids.length || ids.some(id => !has.get(id))) { del.run(r.key); n++; }
  }
  return n;
}

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
      // что программа знает о каждом найденном письме (последние 20): загружено, «чека нет», ошибка или ещё не смотрели
      const seen = D.db.prepare('SELECT status, note, archive_ids FROM mail_seen WHERE key=?');
      const letters = [];
      for (const uid of uids.slice(-20)) {
        const msg = await c.fetchOne(uid, { uid: true, envelope: true }, { uid: true });
        if (!msg || !msg.envelope) continue;
        const env = msg.envelope;
        const key = env.messageId || `${m.folder || 'INBOX'}:${c.mailbox.uidValidity}:${uid}`;
        const from = ((env.from || [])[0] || {}).address || '';
        const sn = seen.get(key) || null;
        letters.push({ date: env.date ? new Date(env.date).toISOString() : null, from, shop: shopFor(from), subject: (env.subject || '').slice(0, 120),
          status: sn ? sn.status : 'new', note: sn ? sn.note : null });
      }
      return { ok: true, total: c.mailbox.exists, receipts90d: uids.length, senders: senders().length, letters };
    } finally { lock.release(); }
  } catch (e) { throw friendly(e); }
  finally { try { await c.logout(); } catch (_) { /* уже закрыто */ } }
}

let running = null;
/** Загрузить новые чеки из почты в архив. */
function fetchReceipts({ render, retry = false } = {}) {
  if (running) return running;
  running = (async () => {
    let m = settings.get().mail;
    const started = new Date().toISOString();
    // явная проверка («Сохранить и проверить почту») или новая версия распознавания — перечитать письма без чека и с ошибкой;
    // заодно — на всю глубину, чтобы такие письма попали в поиск
    let deep = false;
    if (retry || (+m.extractV || 1) < EXTRACT_V) {
      const n = forgetFailed(); deep = true;
      settings.patch('mail', { extractV: EXTRACT_V });
      if (n) log.info(`Почта: писем без чека или с ошибкой — снова в проверке: ${n}`);
      m = settings.get().mail;
    }
    const last = m.lastCheck ? new Date(m.lastCheck) : null;
    // обычно — с прошлой проверки (с запасом 3 дня); впервые и после добавления магазина — на всю глубину
    const since = last && !m.rescan && !deep ? new Date(last.getTime() - 3 * 864e5) : new Date(Date.now() - (+m.depthDays || 90) * 864e5);
    const res = { checked: 0, imported: 0, receipts: 0, skipped: 0, errors: 0, ids: [], letters: [] };
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
            const r = await extract(parsed, { key, store: shopFor(from), render, fetchText, fromStore: !!senderOf(from) });
            for (const e of r.entries) { store.archivePut(e); res.ids.push(e.id); }
            mark.run(key, folder, uid, parsed.date ? new Date(parsed.date).toISOString() : null, from, r.subject, JSON.stringify(r.entries.map(e => e.id)),
              r.entries.length ? 'imported' : 'no_receipt', r.note || null, new Date().toISOString());
            if (r.entries.length) { res.imported++; res.receipts += r.entries.length; } else res.skipped++;
            res.letters.push({ date: parsed.date ? new Date(parsed.date).toISOString() : null, from, shop: shopFor(from), subject: r.subject, status: r.entries.length ? 'imported' : 'no_receipt', note: r.note || null, n: r.entries.length });
          } catch (x) {
            res.errors++;
            log.warn('Почта: письмо', uid, x.message);
            mark.run(key, folder, uid, null, '', (env.envelope || {}).subject || '', '[]', 'error', x.message.slice(0, 200), new Date().toISOString());
            res.letters.push({ date: null, from: '', shop: '', subject: (env.envelope || {}).subject || '', status: 'error', note: x.message.slice(0, 200), n: 0 });
          }
        }
      } finally { lock.release(); }
      settings.patch('mail', { lastCheck: new Date().toISOString(), rescan: false, lastResult: { at: new Date().toISOString(), ...res, ids: undefined, letters: undefined } });
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

module.exports = { test, fetchReceipts, pendingCount, PRESETS, senders, EXTRACT_V };
