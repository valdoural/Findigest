'use strict';
/** Превращает выгрузку MCP-интеграции Zenmoney в ответ Zenmoney API /v8/diff — для проверки синхронизации без токена. */
const load = require('./mcp-fixture');
module.exports = function toDiff(dir) {
  const f = load(dir, '2099-01-01');
  const inst = [{ id: 2, shortTitle: 'RUB', rate: 1 }, { id: 1, shortTitle: 'USD', rate: f.rates.USD }];
  const iid = c => (c === 'USD' ? 1 : 2);
  const banks = [...new Set(f.accounts.map(a => a.bank).filter(Boolean))];
  const TYPE = { card: 'ccard', checking: 'checking', cash: 'cash', loan: 'loan' };
  return {
    serverTimestamp: 1793030000,
    user: [{ id: 1, currency: 2, login: 'test' }],
    instrument: inst,
    company: banks.map((t, i) => ({ id: 100 + i, title: t })),
    account: f.accounts.map(a => ({ id: a.id, title: a.name, type: TYPE[a.type] || 'checking', instrument: iid(a.instrument), company: a.bank ? 100 + banks.indexOf(a.bank) : null,
      balance: a.balance, startBalance: a.startBalance, creditLimit: 0, inBalance: a.inBalance, savings: !!a.savings, archive: false })),
    tag: Object.entries(f.categories).map(([id, c]) => ({ id, title: c.name, parent: null, showIncome: c.isIncome, showOutcome: c.isExpense })),
    merchant: Object.entries(f.merchants).map(([id, title]) => ({ id, title })),
    transaction: f.tx.map(t => ({ id: t.id, date: t.date, deleted: false, hold: false,
      income: t.inAmt || 0, outcome: t.outAmt || 0,
      incomeAccount: t.inAcc || t.outAcc, outcomeAccount: t.outAcc || t.inAcc,
      tag: t.cat ? [t.cat] : null, merchant: t.merchant, originalPayee: t.payee || null, comment: t.comment || null })),
  };
};
