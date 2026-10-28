'use strict';
/**
 * Расходы «как в Zenmoney» по дням и по месяцам. Ожидаемые значения сняты 27.10.2026 с Zenmoney
 * (экран пользователя и отчёт get_monthly_report): возврат — доход в расходной категории, уменьшает расход в свой день;
 * расход в доходной категории — не расход. node test/zen-rules-test.js <выгрузка Zenmoney на 27.10.2026>
 */
const load = require('./mcp-fixture');
const { build } = require('../src/main/digest/build');
const D = build({ ...load(process.argv[2], '2026-10-27'), months: 24 });
let bad = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) bad++; };
const OCT = [8084, 23851, 20118, 22171, 23569, 29391, 30846, 35294, 43528, 57167, 57762, 59280, 59411, 75476, 77638, 81224.5, 84171, 84366, 87551, 87551, 87955, 88055, 94585, 101638, 103772, 115569, 116902];
let a = 0; const diff = [];
D.TX.slice(0, 27).forEach((d, i) => { a += d.reduce((s, r) => s + r[1], 0); if (Math.abs(a - OCT[i]) > 1) diff.push(`${i + 1}: ${Math.round(a)} ≠ ${OCT[i]}`); });
ok(!diff.length, 'октябрь по дням совпадает с Zenmoney (1–27 окт.)' + (diff.length ? ': ' + diff.join('; ') : ''));
// помесячно: [расход, доход] по Zenmoney
const MONTHS = { '2025-10': [1245549, 226291], '2025-11': [84529, 227452], '2025-12': [163784, 568109], '2026-01': [87565, 1240321],
  '2026-02': [1724815, 309300], '2026-03': [150142, 299379], '2026-04': [116992, 423479], '2026-05': [174500, 1813257],
  '2026-06': [137693, 323369], '2026-07': [333506, 504396], '2026-08': [85359, 299553], '2026-09': [147691, 310799] };
const start = D.meta.monStart, idx = m => (+m.slice(0, 4) - +start.slice(0, 4)) * 12 + (+m.slice(5) - +start.slice(5));
const md = Object.entries(MONTHS).filter(([m, [e, i]]) => { const o = D.MON[idx(m)]; return Math.abs(o[1] - e) > 1 || Math.abs(o[0] - i) > 1; }).map(([m]) => m);
ok(!md.length, `помесячные расходы и доходы совпадают с Zenmoney (${Object.keys(MONTHS).length} мес.)` + (md.length ? ': ' + md.join(', ') : ''));
ok(Math.abs(D.SEP_TOT - 147691) <= 1 && D.SEP.length === 30, `прошлый месяц по дням — то же правило: сентябрь ${Math.round(D.SEP_TOT)} ₽`);
ok(Math.abs(D.MS.at(-1).t - 147691) <= 1, 'средние за 3/6 мес. — из тех же помесячных сумм');
ok(D.Y_CUR[1] === 1724815 && D.Y_CUR[8] === 147691, 'сравнение лет — те же помесячные суммы');
const pySum = D.PY.reduce((s, v) => s + v, 0); ok(Math.abs(pySum - 1245549) <= 1, `тот же месяц прошлого года по дням: ${Math.round(pySum)} ₽`);
const bday = D.TX[25].filter(r => r[1] === 17500); ok(!bday.length, 'переданные дальше деньги на день рождения — не расход');
ok(D.signals.refunds.reduce((s, r) => s + r.sum, 0) === 26768, 'возвраты октября: 26 768 ₽ (кафе, займ, алкоголь, Ozon)');
process.exitCode = bad ? 1 : 0;
