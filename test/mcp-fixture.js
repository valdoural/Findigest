'use strict';
/** Загрузка выгрузки Zenmoney (формат MCP-интеграции) в нормализованный вид для build(). Только для тестов. */
const fs = require('fs');
const path = require('path');
module.exports = function load(dir, today) {
  const tx = {}, categories = {}, merchants = {};
  for (const f of fs.readdirSync(dir).filter(f => /^p\d+\.json$/.test(f))) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const t of d.data) tx[t.id] = t;
    Object.assign(categories, d.references.categories || {});
    for (const [id, m] of Object.entries(d.references.merchants || {})) merchants[id] = m.name;
  }
  const accounts = JSON.parse(fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8'));
  const norm = Object.values(tx).map(t => ({
    id: t.id, date: t.date,
    inAcc: t.income ? t.income.accountId : null, inAmt: t.income ? t.income.amount : 0,
    outAcc: t.expense ? t.expense.accountId : null, outAmt: t.expense ? t.expense.amount : 0,
    cat: t.categoryId || null, merchant: t.merchantId || null, payee: t.originalPayee || '', comment: t.comment || '',
  }));
  const cats = Object.fromEntries(Object.entries(categories).map(([id, c]) => [id, { name: c.name, isIncome: c.isIncome, isExpense: c.isExpense }]));
  return { accounts, categories: cats, merchants, rates: { RUB: 1, USD: 80.5381 }, tx: norm, today };
};
