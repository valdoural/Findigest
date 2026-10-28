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

// \b в JavaScript не видит границ русских слов — границы заданы явно
const NL = '(?<![А-Яа-яЁёA-Za-z])', NR = '(?![А-Яа-яЁёA-Za-z])';
const RECEIPT_WORDS = new RegExp(`(кассов[а-яё]* чек|электронн[а-яё]* чек|итог|к оплате|фискальн|ОФД|приход|${NL}(?:ФН|ФД|ФП|ККТ)${NR}|${NL}чек${NR})`, 'i');
// сумма с копейками («1 234,56») или целыми рублями со знаком («1 234 ₽», «599 руб»)
const MONEY = /\d[\d\s ]*[.,]\d{2}(?!\d)|\d{1,3}(?:[\s ]\d{3})*\s?(?:₽|руб)/;
const looksLikeReceipt = t => !!t && RECEIPT_WORDS.test(t) && MONEY.test(t);
// письмо от магазина из списка, где упоминается чек или покупка (рекламу без этих слов не берём)
const STORE_HINT = new RegExp(`${NL}(чек|покупк[а-яё]*|заказ[а-яё]*|оплат[а-яё]*)${NR}`, 'i');
// ссылки на чек на сайте ОФД / ФНС — открываем и берём чек оттуда
const RECEIPT_LINK = /(ofd|nalog\.gov\.ru|taxcom|platformaofd|1-ofd|ofd-ya|kontur|sbis|check|receipt|cheque|чек)/i;
function receiptLinks(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = m[1].replace(/&amp;/g, '&'), label = htmlToText(m[2]);
    if (!/^https?:\/\//i.test(url)) continue;
    if (RECEIPT_LINK.test(url) || /чек/i.test(label)) out.push(url);
  }
  return [...new Set(out)].slice(0, 3);
}

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
async function extract(parsed, { key, store = '', render, fetchText, fromStore = false }) {
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
    else {
      // чек только по ссылке («Посмотреть чек») — открываем страницу ОФД
      for (const url of fetchText ? receiptLinks(parsed.html) : []) {
        try {
          const page = await fetchText(url);
          const pt = /<\w/.test(page) ? htmlToText(page) : page;
          if (looksLikeReceipt(pt)) { const e = base('link', subject); e.text = pt.slice(0, 20000); e.link = url; entries.push(e); notes.push('чек по ссылке'); break; }
        } catch (x) { notes.push('ссылка на чек не открылась: ' + x.message); }
      }
      // письмо от магазина из списка про чек/покупку — в архив, его разберёт ИИ (лучше лишнее письмо, чем потерянный чек)
      if (!entries.length && fromStore && (STORE_HINT.test(subject) || STORE_HINT.test(t)) && MONEY.test(subject + '\n' + t)) {
        const e = base('body', subject); e.text = t.slice(0, 20000); e.unsure = true; entries.push(e);
        notes.push('письмо магазина не похоже на стандартный чек — сохранено для разбора');
      }
      if (!entries.length) notes.push(fromStore ? `в письме не найден чек${t.length < 15 ? ' (в письме почти нет текста — возможно, чек картинкой)' : ''}` : 'в письме нет чека');
    }
  }
  return { entries, note: notes.join('; '), from, subject, maildate };
}

module.exports = { extract, htmlToText, looksLikeReceipt, receiptLinks };
