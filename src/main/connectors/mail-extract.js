'use strict';
/**
 * Письмо → записи архива чеков (в том же формате, что создаёт отчёт при ручной загрузке).
 *   PDF-вложение с текстом → text (+ первая страница картинкой для просмотра)
 *   PDF-скан              → pages (картинки страниц) — их читает ИИ
 *   фото-вложение         → img
 *   HTML/текст письма     → text (если похоже на чек)
 * Вложения важнее тела письма: если чек пришёл файлом, текст письма не дублируется.
 */
const crypto = require('crypto');

const RECEIPT_WORDS = /(кассов\w* чек|электронн\w* чек|чек\b|итог|итого|к оплате|сумма|ФН\b|ФД\b|ФП\b|фискальн|ОФД|приход)/i;
const MONEY = /\d[\d\s]*[.,]\d{2}\b/;
const looksLikeReceipt = t => !!t && RECEIPT_WORDS.test(t) && MONEY.test(t);

function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|table|section)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .split('\n').map(l => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n');
}

const isoDay = d => { const x = d instanceof Date ? d : new Date(d); return isNaN(x) ? '' : `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

/**
 * @param parsed  результат mailparser.simpleParser
 * @param opts    { key, store, render: {pdf(buf), image(buf,mime)} }
 * @returns       { entries: [...], note }
 */
async function extract(parsed, { key, store = '', render }) {
  const subject = (parsed.subject || '').trim();
  const from = ((parsed.from && parsed.from.value && parsed.from.value[0]) || {}).address || '';
  const maildate = isoDay(parsed.date || new Date());
  const id = part => 'm' + crypto.createHash('sha1').update(key + '|' + part).digest('hex').slice(0, 12);
  const base = (part, name) => ({
    id: id(part), kind: 'receipt', created: new Date().toISOString(), status: 'new',
    name: `✉ ${name || subject || 'Письмо'}`.slice(0, 90), store, date: '', mstore: store, mdate: '',
    source: 'mail', maildate, mail: { from, subject: subject.slice(0, 160), date: parsed.date ? new Date(parsed.date).toISOString() : null },
  });
  const entries = [];
  const notes = [];

  for (const [k, a] of (parsed.attachments || []).entries()) {
    const type = (a.contentType || '').toLowerCase(), name = a.filename || `вложение ${k + 1}`;
    try {
      if (type === 'application/pdf' || /\.pdf$/i.test(name)) {
        const p = await render.pdf(a.content);
        const hasT = p.text && p.text.replace(/\s/g, '').length > 60 && /\d[.,]\d{2}/.test(p.text);
        if (hasT && !looksLikeReceipt(p.text)) { notes.push(`${name}: не похоже на чек`); continue; }
        const e = base('att' + k, name);
        if (hasT) { e.text = p.text.slice(0, 20000); e.pages = p.pages.slice(0, 1); }
        else e.pages = p.pages;
        e.img = p.pages[0];
        entries.push(e);
      } else if (/^image\/(jpeg|png|webp|gif|bmp)/.test(type)) {
        if ((a.size || a.content.length) < 15000 || a.contentDisposition === 'inline') continue; // логотипы и иконки в письме
        const e = base('att' + k, name);
        e.img = await render.image(a.content, type);
        entries.push(e);
      } else if (/^text\/(html|plain)/.test(type) || /\.(html?|txt|eml)$/i.test(name)) {
        const raw = a.content.toString('utf8');
        const t = /html/.test(type) || /\.html?$/i.test(name) ? htmlToText(raw) : raw;
        if (!looksLikeReceipt(t)) continue;
        const e = base('att' + k, name); e.text = t.slice(0, 20000); entries.push(e);
      }
    } catch (x) { notes.push(`${name}: ${x.message}`); }
  }

  if (!entries.length) {
    const t = parsed.html ? htmlToText(parsed.html) : (parsed.text || '');
    if (looksLikeReceipt(t)) { const e = base('body', subject); e.text = t.slice(0, 20000); entries.push(e); }
    else notes.push('в письме нет чека');
  }
  return { entries, note: notes.join('; '), from, subject, maildate };
}

module.exports = { extract, htmlToText, looksLikeReceipt };
