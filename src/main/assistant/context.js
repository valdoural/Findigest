'use strict';
/**
 * Сводка для помощника: короткий срез ваших данных, чтобы на типичные вопросы ИИ отвечал сразу,
 * без запросов к базе («сколько потратил в этом месяце», «сколько до цели»). Детали ИИ добирает SQL-запросом.
 */
const D = require('../db/database');
const service = require('../digest/service');

const r0 = v => Math.round(+v || 0);
const doc = id => { try { const r = D.db.prepare("SELECT json FROM docs WHERE id=? ORDER BY updated_at DESC LIMIT 1").get(id); return r ? (JSON.parse(r.json) || {}).v : null; } catch (_) { return null; } };
const med = a => { const s = [...a].sort((x, y) => x - y), k = s.length; return k ? (k % 2 ? s[(k - 1) / 2] : (s[k / 2 - 1] + s[k / 2]) / 2) : 0; };

function build() {
  const out = { сегодня: new Date().toISOString().slice(0, 10) };
  const d = service.get();
  if (d && d.meta) {
    const m = d.meta;
    out.данные_zenmoney = { история_с: m.firstDmy, операции_до: m.lastDmy, обновлено: d.syncedAt || null };
    // текущий месяц по категориям (с возвратами) и прогноз = медиана трёх прошлых месяцев
    const cur = {};
    d.TX.forEach(day => day.forEach(([c, v]) => { cur[c] = (cur[c] || 0) + v; }));
    const cats = [...new Set([...Object.keys(cur), ...Object.values(d.HIST).flatMap(Object.keys)])];
    const fc = Object.fromEntries(cats.map(c => [c, r0(med(d.FM3.map(x => (d.HIST[x] || {})[c] || 0)))]).filter(x => x[1] > 0));
    out.текущий_месяц = {
      месяц: m.curMonth, день: m.day, дней_в_месяце: m.monthLen,
      расходы_с_возвратами: r0(Object.values(cur).reduce((a, b) => a + b, 0)),
      по_категориям: Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, r0(v)]).sort((a, b) => b[1] - a[1])),
      прогноз_по_категориям_медиана_3_мес: fc, прогноз_всего: r0(Object.values(fc).reduce((a, b) => a + b, 0)),
      доход_всего: d.INC, зарплата: d.ZP,
    };
    const months = []; for (let i = 0; i < d.MON.length; i++) { const [y, mm] = m.monStart.split('-').map(Number); const t = new Date(y, mm - 1 + i, 1); months.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`); }
    out.по_месяцам = months.slice(-12).map((k, i, a) => { const j = d.MON.length - a.length + i; return { месяц: k, доход: d.MON[j][0], расход: d.MON[j][1], жкх: d.UT[j] }; });
    out.прошлый_месяц_по_категориям = Object.fromEntries(Object.entries(d.SEPCAT).map(([k, v]) => [k, r0(v)]));
    out.счета = d.AC.map(a => ({ счёт: a[0], остаток_руб: a[3] }));
    out.капитал = { свободные_деньги: d.P.fr, остаток_ипотеки: d.P.mb, платёж_ипотеки: d.P.mp };
    if (d.signals && d.signals.bigUnexplained && d.signals.bigUnexplained.length) out.крупные_операции_без_пояснений = d.signals.bigUnexplained;
  } else {
    out.данные_zenmoney = 'не подключены — в отчёте условные данные';
  }
  const par = doc('par'), goals = doc('goals4');
  if (par) out.допущения_пользователя = { прирост_сбережений_в_мес: par.sv, ставка_вклада_проц: par.rt, ключевая_ставка: par.key };
  if (Array.isArray(goals)) out.цели = goals.map(g => ({ название: g.n, тип: ({ sum: 'накопление', trip: 'отпуск', mort: 'закрыть ипотеку и оставить резерв', pass: 'пассивный доход в месяц' })[g.t] || g.t, сумма: g.a, накоплено: g.v || 0, срок: g.d || null, выполнена: !!g.done }));
  try {
    const rc = D.db.prepare("SELECT substr(date,1,7) m, COUNT(DISTINCT src) n, ROUND(SUM(sum)) s FROM receipt_items GROUP BY m ORDER BY m DESC LIMIT 3").all();
    if (rc.length) out.чеки_по_месяцам = rc.map(x => ({ месяц: x.m, чеков: x.n, сумма: x.s }));
    const bi = D.db.prepare("SELECT period, type, ROUND(SUM(sum),2) s FROM bill_items GROUP BY period, type ORDER BY period DESC LIMIT 6").all();
    if (bi.length) out.квитанции_жкх = bi;
  } catch (_) { /* таблиц может не быть в старой базе */ }
  return out;
}

module.exports = { build };
