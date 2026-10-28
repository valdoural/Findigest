'use strict';
/**
 * Сверка: модуль расчёта на реальной выгрузке ↔ цифры, зашитые в веб-версию (снимок 26.10.2026).
 * node test/compare-web.js <папка-выгрузки>
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { build } = require('../src/main/digest/build');
const load = require('./mcp-fixture');

const web = fs.readFileSync(path.join(__dirname, '..', 'reference', 'digest.web.html'), 'utf8');
const grab = name => { const m = new RegExp('const ' + name + '=([\\s\\S]*?);\\n').exec(web) || new RegExp('const ' + name + '=([^;]*);').exec(web); return vm.runInNewContext('(' + m[1] + ')'); };
const W = { HIST: grab('HIST'), SEP: grab('SEP'), PY: grab('PY'), MS: grab('MS'), MON: grab('MON'), AC: grab('AC'), UT: grab('UT'), SEPCAT: grab('SEPCAT'), PYCAT: grab('PYCAT') };
const kl = /FM=(\[[^\]]*\]),MM=(\[[^\]]*\])/.exec(web); W.FM = JSON.parse(kl[1]); W.MM = JSON.parse(kl[2]);

const D = build({ ...load(process.argv[2], '2026-10-26'), months: 1000 }); // вся история — для сверки с веб-версией
let bad = 0;
const near = (a, b, tol) => Math.abs(a - b) <= tol;
function cmp(label, a, b, tol = 1) {
  const diff = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (!near(+a[i] || 0, +b[i] || 0, tol)) diff.push(`#${i}: расчёт ${a[i]} / веб ${b[i]}`);
  console.log((diff.length ? '✗ ' : '✓ ') + label + (diff.length ? '  ' + diff.join('; ') : ''));
  bad += diff.length ? 1 : 0;
}
function cmpObj(label, a, b, tol = 1) {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const diff = keys.filter(k => !near(a[k] || 0, b[k] || 0, tol)).map(k => `${k}: ${a[k] || 0} / ${b[k] || 0}`);
  console.log((diff.length ? '✗ ' : '✓ ') + label + (diff.length ? '  ' + diff.join('; ') : ''));
  bad += diff.length ? 1 : 0;
}
cmp('MON доход (32 мес.)', D.MON.map(x => x[0]), W.MON.map(x => x[0]));
cmp('MON расход (32 мес.)', D.MON.map(x => x[1]), W.MON.map(x => x[1]));
for (const m of D.FM3) cmpObj('HIST ' + m, D.HIST[m], W.HIST[m]);
cmp('SEP по дням', D.SEP, W.SEP, 1.5);
cmpObj('SEPCAT', D.SEPCAT, W.SEPCAT);
cmp('PY по дням', D.PY, W.PY, 0.01);
cmpObj('PYCAT', D.PYCAT, W.PYCAT);
cmp('MS итог', D.MS.map(x => x.t), W.MS.map(x => x.t));
cmp('MS разовые', D.MS.map(x => x.b), W.MS.map(x => x.b));
cmp('UT ЖКХ', D.UT, W.UT);
cmp('FM свободные, тыс.', D.FM, W.FM);
cmp('MM ипотека, тыс.', D.MM, W.MM);
cmpObj('AC счета', Object.fromEntries(D.AC.map(a => [a[0], a[3]])), Object.fromEntries(W.AC.map(a => [a[0], a[3]])));
// окно графиков по умолчанию и защита от служебных записей с нулевой датой
{
  const inp = load(process.argv[2], '2026-10-26');
  inp.tx.push({ id: 'bogus', date: '1970-01-01', outAcc: inp.tx[0].outAcc || inp.tx[1].outAcc, outAmt: 1, inAcc: null, inAmt: 0, cat: null });
  const W = build(inp);
  const okW = W.MON.length === 24 && W.meta.monStart === '2024-11' && W.KL.length === 24 && W.UT.length === 24 && W.meta.historyStart === '2024-03';
  console.log((okW ? '✓ ' : '✗ ') + `окно по умолчанию: ${W.MON.length} мес. с ${W.meta.monStart}, запись 1970 года отброшена, история для остатков с ${W.meta.historyStart}`);
  if (!okW) bad++;
}
// ипотека: API Zenmoney отдаёт в startBalance кредита исходную сумму договора со знаком «плюс» — история должна остаться положительной
{
  const inp = load(process.argv[2], '2026-10-26');
  inp.accounts = inp.accounts.map(a => (a.type === 'loan' ? { ...a, startBalance: 4200000 } : a));
  const L = build(inp);
  const last = L.MM.length - 1;
  const okL = L.MM.every(v => v > 0) && L.MM[0] > L.MM[last] && Math.abs(L.MM[last] - Math.round(L.P.mb / 1000)) <= 1;
  console.log((okL ? '✓ ' : '✗ ') + `ипотека в истории положительная при startBalance договора: ${L.MM[0]} → ${L.MM[last]} тыс. (свободные сейчас ${L.FM[last]})`);
  if (!okL) bad++;
}
console.log('\nP:', D.P, ' ZP:', D.ZP, ' INC:', D.INC, ' CATN:', D.CATN.join(', '));
console.log('meta:', JSON.stringify(D.meta));
console.log('Возвраты октября:', JSON.stringify(D.signals.refunds));
console.log('Крупные без пояснений:', JSON.stringify(D.signals.bigUnexplained));
console.log('Y_PREV:', D.Y_PREV.join(','), '\nY_CUR:', D.Y_CUR.join(','));
console.log('TX 1–3 окт.:', JSON.stringify(D.TX.slice(0, 3)));
console.log(bad ? `\nРасхождений: ${bad}` : '\nВсё совпало');
