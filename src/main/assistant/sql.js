'use strict';
/**
 * Запросы помощника к базе — строго только чтение:
 *   • отдельное подключение SQLite в режиме readOnly (даже ошибка в проверке не даст ничего изменить);
 *   • один оператор, начинается с SELECT или WITH, без PRAGMA/ATTACH и т.п.;
 *   • не больше MAX_ROWS строк, длинные значения обрезаются.
 */
const { DatabaseSync } = require('node:sqlite');
const { P } = require('../paths');

const MAX_ROWS = 200;
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|analyze|begin|commit|rollback|savepoint|release)\b/i;

let ro = null;
const conn = () => (ro || (ro = new DatabaseSync(P.db, { readOnly: true })));

function check(sql) {
  const s = String(sql || '').trim().replace(/;\s*$/, '');
  if (!s) throw new Error('пустой запрос');
  if (s.includes(';')) throw new Error('разрешён только один запрос');
  if (!/^(select|with)\b/i.test(s)) throw new Error('разрешены только запросы SELECT');
  if (FORBIDDEN.test(s.replace(/'[^']*'/g, "''"))) throw new Error('запрос пытается изменить базу');
  return s;
}

function run(sql) {
  const s = check(sql);
  const st = conn().prepare(s);
  const rows = [];
  for (const r of st.iterate()) {
    const o = {};
    for (const [k, v] of Object.entries(r)) o[k] = typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : typeof v === 'number' ? Math.round(v * 100) / 100 : v;
    rows.push(o);
    if (rows.length >= MAX_ROWS) break;
  }
  return { rows, truncated: rows.length >= MAX_ROWS };
}

function close() { if (ro) { ro.close(); ro = null; } }

/** Описание схемы для ИИ: только то, что ему нужно знать. */
const SCHEMA = `
Таблицы и представления SQLite (только чтение):
v_ops(id, date 'ГГГГ-ММ-ДД', month 'ГГГГ-ММ', type 'expense'|'income'|'transfer', amount_rub, category, payee, comment, from_account, to_account, in_balance 0|1)
  — все операции Zenmoney. Расход за период = SUM(amount_rub) WHERE type='expense' AND in_balance=1 AND category<>'Корректировка'.
    Доход = то же с type='income'. Переводы между своими счетами (type='transfer') не являются ни доходом, ни расходом.
    Магазины ищите по payee через LIKE с разными регистрами, например payee LIKE '%ятёрочк%' OR payee LIKE '%YATEROCHK%'.
v_accounts(id, name, type 'cash'|'ccard'|'checking'|'loan'|'deposit'|'debt', currency, balance, balance_rub, in_balance, savings, archive, bank) — счета и текущие остатки.
receipt_items(date, store, name, sum, grp) — позиции из разобранных чеков (продукты по группам: «Овощи и фрукты», «Сладости и снеки»…).
bill_items(period 'ГГГГ-ММ', type 'УК'|'ЭСК'|'ЕРЦ ВС', name, qty, rate, sum) — строки квитанций ЖКХ.
archive(id, kind 'receipt'|'bill', status, name, store, date, period, total, source 'manual'|'mail') — загруженные документы.
`.trim();

module.exports = { run, check, close, SCHEMA, MAX_ROWS };
