'use strict';
/** Проверка синхронизации: полная загрузка → изменения (правка, удаление, новая операция) → пересчёт. xvfb-run electron --no-sandbox test/sync-test.js <выгрузка> */
const { app } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-sync-'));
app.setPath('userData', DATA);
app.whenReady().then(async () => {
  const D = require('../src/main/db/database'); require('../src/main/config/settings').load(); D.open();
  const zen = require('../src/main/connectors/zenmoney');
  const { build } = require('../src/main/digest/build');
  const full = require('./mcp-to-diff')(process.argv[process.argv.length - 1]);
  const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };
  let n = zen.apply(full);
  ok(n.tx === full.transaction.length, `полная загрузка: ${n.tx} операций`);
  const before = build(zen.load('2026-10-26'));
  const victim = full.transaction.find(t => t.date === '2026-10-02' && t.outcome === 23940); // крупная трата 2 октября
  const edit = { ...full.transaction.find(t => t.date === '2026-10-01' && t.outcome === 8000), outcome: 9000 };
  const neu = { id: 'new-1', date: '2026-10-26', income: 0, outcome: 777, incomeAccount: edit.outcomeAccount, outcomeAccount: edit.outcomeAccount, tag: edit.tag, merchant: null, originalPayee: 'Тест', deleted: false };
  n = zen.apply({ serverTimestamp: 1793039999, transaction: [edit, neu], deletion: [{ id: victim.id, object: 'transaction', stamp: 1 }] });
  const after = build(zen.load('2026-10-26'));
  const dSum = (a, b) => Math.round(a.MON.at(-1)[1] - b.MON.at(-1)[1]);
  ok(dSum(after, before) === 1000 + 777 - 23940, `изменения: расход октября ${dSum(after, before)} ₽ (ожидалось ${1000 + 777 - 23940})`);
  ok(!after.TX[1].some(r => r[1] === 23940) && before.TX[1].some(r => r[1] === 23940), 'удалённая операция исчезла из дневного графика');
  ok(after.TX[25].some(r => r[1] === 777), 'новая операция появилась 26-го числа');
  ok(D.db.prepare("SELECT value FROM meta WHERE key='zm_server_ts'").get().value === '1793039999', 'метка сервера сохранена для следующей синхронизации');
  app.exit(process.exitCode || 0);
});
