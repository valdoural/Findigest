'use strict';
/**
 * Расчёт данных отчёта из операций Zenmoney.
 * На входе — нормализованные данные (см. normalize в connectors/zenmoney.js):
 *   accounts:   [{id, name, type, instrument, balance, inBalance, savings, archived, bank}]
 *   categories: {id: {name, isIncome, isExpense}}
 *   merchants:  {id: name}
 *   rates:      {RUB:1, USD:80.5, …}  — рублей за единицу
 *   tx:         [{id, date, inAcc, inAmt, outAcc, outAmt, cat, merchant, payee, comment}]
 *   today:      'YYYY-MM-DD'
 * На выходе — те же наборы, которые раньше были «зашиты» в страницу (TX, HIST, MON, AC …).
 *
 * Расходы и доходы считаются как в приложении Zenmoney (сверено по дням октября 2026 с экраном пользователя):
 *   • учитываются операции «доход» и «расход» по счетам «в балансе», переводы — нет;
 *   • расход в расходной категории (или без категории, или в «Корректировке») — расход в день операции;
 *   • доход в расходной категории (не доходной) — возврат: в день поступления уменьшает расход этой категории и не идёт в доходы;
 *   • расход в доходной категории (переданные дальше деньги на день рождения, 5 764 ₽ в «Зарплате») — не расход,
 *     а уменьшение дохода этой категории;
 *   • одно и то же правило — для всех срезов: текущий месяц по дням, прошлый месяц, тот же месяц прошлого года,
 *     средние за 3/6 месяцев, помесячные итоги, категории, сравнение лет;
 *   • «разовые крупные траты» — операции от BIG_OP ₽: выключатель «без разовых трат от 100 тыс.» убирает их из средних и линий сравнения.
 */

const BIG_OP = 100000;
const BUILD_VERSION = 6; // меняется при изменении правил расчёта — сохранённый набор пересчитывается
const BASE_CATN = ['Кафе и рестораны', 'Продукты', 'Покупки', 'Здоровье', 'Услуги', 'Коммуналка', 'Путешествия', 'Подарки', 'Алкоголь', 'Переводы и займ', 'Транспорт', 'Развлечения'];
const TRANSFERS = 'Переводы и займ';
const MN = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MN_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MN_SHORT = ['янв.', 'фев.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сен.', 'окт.', 'ноя.', 'дек.'];
const MN_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const BANK = [[/яндекс/i, 'Яндекс', '#C8402B'], [/альфа/i, 'Альфа', '#C53A30'], [/сбер/i, 'Сбер', '#2E8B47'], [/ozon|озон/i, 'Ozon', '#2F5FD0'], [/т-банк|тинькофф|tinkoff/i, 'Т-Банк', '#3A3A3A'], [/втб/i, 'ВТБ', '#1E4BD2']];
const GENERIC = /^(карта|счёт|счет|основной|кошелёк|кошелек)$/i;
// Сайты банков — когда Zenmoney не прислал адрес (company.www). По сайту загружается логотип.
const BANK_SITE = [[/яндекс/i, 'bank.yandex.ru'], [/альфа/i, 'alfabank.ru'], [/сбер/i, 'sberbank.ru'], [/ozon|озон/i, 'finance.ozon.ru'],
  [/т-банк|тинькофф|tinkoff|т‑банк/i, 'tbank.ru'], [/втб/i, 'vtb.ru'], [/газпромбанк/i, 'gazprombank.ru'], [/райффайзен|raiffeisen/i, 'raiffeisen.ru'],
  [/совкомбанк|халва/i, 'sovcombank.ru'], [/почта банк/i, 'pochtabank.ru'], [/мтс/i, 'mtsbank.ru'], [/открытие/i, 'open.ru'], [/росбанк/i, 'rosbank.ru'],
  [/псб|промсвязьбанк/i, 'psbank.ru'], [/уралсиб/i, 'uralsib.ru'], [/убрир|уральский банк реконструкции/i, 'ubrr.ru'], [/синара|скб-банк/i, 'sinara.ru'],
  [/точка/i, 'tochka.com'], [/россельхоз/i, 'rshb.ru'], [/ак барс/i, 'akbars.ru'], [/русский стандарт/i, 'rsb.ru'], [/ренессанс/i, 'rencredit.ru'],
  [/paypal/i, 'paypal.com'], [/revolut/i, 'revolut.com']];
const domainOf = w => String(w || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');

const ym = d => d.slice(0, 7);
const addMonth = (m, k) => { let y = +m.slice(0, 4), mm = +m.slice(5, 7) - 1 + k; y += Math.floor(mm / 12); mm = ((mm % 12) + 12) % 12; return `${y}-${String(mm + 1).padStart(2, '0')}`; };
const monthsBetween = (a, b) => { const out = []; for (let m = a; m <= b; m = addMonth(m, 1)) out.push(m); return out; };
const daysIn = m => new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
const r2 = v => Math.round(v * 100) / 100;
const dm = d => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const dmy = d => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

function build(input) {
  const { accounts, categories, merchants = {}, rates = { RUB: 1 }, tx: allTx, today, months: WINDOW = 24 } = input;
  const acc = Object.fromEntries(accounts.map(a => [a.id, a]));
  const rate = id => rates[(acc[id] || {}).instrument] || 1;
  const inBal = id => !!(acc[id] && acc[id].inBalance);
  const catName = id => (categories[id] || {}).name || '';
  const isCorrection = t => catName(t.cat) === 'Корректировка';
  // служебные записи API бывают с нулевой датой (1970-01-01) — в отчёт не берём; будущие запланированные тоже
  const tx = allTx.filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t.date || '') && t.date >= '2000-01-01' && t.date <= today).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // классификация операции
  const kind = t => (t.inAcc && t.outAcc && t.inAcc !== t.outAcc ? 'transfer' : t.outAcc ? 'expense' : 'income');
  const expOps = tx.filter(t => kind(t) === 'expense' && inBal(t.outAcc));
  const incOps = tx.filter(t => kind(t) === 'income' && inBal(t.inAcc));
  const expRub = t => t.outAmt * rate(t.outAcc);
  const incRub = t => t.inAmt * rate(t.inAcc);

  /** Имя категории для отчёта: займ, переводы без категории и расходы в «доходных» категориях — «Переводы и займ». */
  function dn(t) {
    const c = categories[t.cat];
    if (!c) return TRANSFERS;
    if (c.name === 'Займ' || !c.isExpense) return TRANSFERS;
    return c.name;
  }
  // как в Zenmoney: доход в расходной (не доходной) категории — возврат; расход в доходной (не расходной) — уменьшение дохода
  const isRefund = t => { const c = categories[t.cat]; return !!(c && c.isExpense && !c.isIncome); };
  const isIncomeBack = t => { const c = categories[t.cat]; return !!(c && !c.isExpense); };
  /** Все операции месяца как движения расхода/дохода: {date, exp|inc, v, name, payee, refund}. */
  const flows = [];
  for (const t of expOps) {
    const v = expRub(t);
    if (isIncomeBack(t)) flows.push({ t, date: t.date, inc: true, v: -v });
    else flows.push({ t, date: t.date, exp: true, v, name: dn(t) });
  }
  for (const t of incOps) {
    const v = incRub(t);
    if (isRefund(t)) flows.push({ t, date: t.date, exp: true, v: -v, name: dn(t), refund: true });
    else flows.push({ t, date: t.date, inc: true, v });
  }
  flows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const expFlows = flows.filter(f => f.exp);
  function payee(t, refund) {
    const m = t.merchant && merchants[t.merchant];
    let p = m || t.payee || '';
    if (!p && t.comment) p = /налич/i.test(t.comment) ? 'Наличные' : /перевод|сбп/i.test(t.comment) ? 'Перевод' : t.comment.slice(0, 40);
    if (!p) p = (categories[t.cat] ? 'Без получателя' : 'Без категории');
    p = p.replace(/^По номеру телефона из\s+/i, '');
    if (refund) return 'Возврат: ' + p;
    return p;
  }

  const firstDate = tx.length ? tx[0].date : today;
  const curM = ym(today), prevM = addMonth(curM, -1), pyM = addMonth(curM, -12);
  const allMonths = monthsBetween(ym(firstDate), curM);           // вся история — для остатков и капитала
  const winStart = addMonth(curM, -(Math.max(2, WINDOW) - 1));       // на графиках — последние WINDOW месяцев
  const shown = allMonths.filter(m => m >= winStart);

  /* --- помесячные итоги (как TagTotal в Zenmoney) --- */
  const monInc = {}, monExp = {}, monCat = {}, monUtil = {}, monBig = {};
  for (const m of allMonths) { monInc[m] = 0; monExp[m] = 0; monCat[m] = {}; monUtil[m] = 0; monBig[m] = 0; }
  for (const f of flows) {
    const m = ym(f.date);
    if (f.inc) { monInc[m] += f.v; continue; }
    monExp[m] += f.v;
    if (!f.refund && f.v >= BIG_OP) monBig[m] += f.v;
    monCat[m][f.name] = (monCat[m][f.name] || 0) + f.v;
    if (catName(f.t.cat) === 'Коммуналка') monUtil[m] += f.v;
  }

  const MON = shown.map(m => [Math.round(monInc[m]), Math.round(monExp[m])]);

  /* --- три последних закрытых месяца: база прогноза --- */
  const FM3 = [addMonth(curM, -3), addMonth(curM, -2), addMonth(curM, -1)];
  const HIST = Object.fromEntries(FM3.map(m => [m, Object.fromEntries(Object.entries(monCat[m] || {}).map(([k, v]) => [k, r2(v)]))]));

  /* --- текущий месяц по дням, с возвратами (правило Zenmoney, см. выше) --- */
  const TX = Array.from({ length: daysIn(curM) }, () => []);
  const refunds = [];
  for (const f of expFlows) {
    if (ym(f.date) !== curM) continue;
    TX[+f.date.slice(8) - 1].push([f.name, r2(f.v), payee(f.t, f.refund)]);
    if (f.refund) refunds.push({ cat: f.name, sum: r2(-f.v), who: payee(f.t), catName: catName(f.t.cat) });
  }

  /* --- любой месяц по дням и по категориям — по тому же правилу --- */
  const dailyOf = m => {
    const a = Array(daysIn(m)).fill(0), c = {};
    for (const f of expFlows) {
      if (ym(f.date) !== m) continue;
      a[+f.date.slice(8) - 1] += f.v;
      c[f.name] = (c[f.name] || 0) + f.v;
    }
    return { d: a.map(r2), c: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, r2(v)])) };
  };
  const sep = dailyOf(prevM), py = dailyOf(pyM);
  // разовые траты от BIG_OP ₽ по дням — чтобы выключатель «без трат от 100 тыс.» убирал их и из линий сравнения
  const bigDaily = m => { const a = Array(daysIn(m)).fill(0); for (const f of expFlows) if (ym(f.date) === m && !f.refund && f.v >= BIG_OP) a[+f.date.slice(8) - 1] += f.v; return a.map(r2); };

  /* --- последние 6 закрытых месяцев: итог и разовые крупные траты --- */
  const MS = [-6, -5, -4, -3, -2, -1].map(k => addMonth(curM, k)).map(m => ({ t: Math.round(monExp[m] || 0), b: Math.round(monBig[m] || 0) }));

  /* --- сравнение лет: помесячные расходы по тому же правилу --- */
  const yearSeries = y => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`)
    .filter(m => m <= curM && m >= ym(firstDate)).map(m => Math.round(monExp[m] || 0));
  const Y = +curM.slice(0, 4);

  /* --- категории в порядке отчёта + новые в конце --- */
  const spend = {};
  for (const m of [...FM3, curM]) for (const [k, v] of Object.entries(monCat[m] || {})) spend[k] = (spend[k] || 0) + v;
  const CATN = [...BASE_CATN, ...Object.keys(spend).filter(k => !BASE_CATN.includes(k)).sort((a, b) => spend[b] - spend[a])];

  /* --- счета --- */
  const balRub = a => a.balance * (rates[a.instrument] || 1);
  const AC = accounts.filter(a => a.inBalance && !a.archived && Math.abs(a.balance) >= 1)
    .map(a => {
      const b = BANK.find(x => x[0].test(a.bank || '')) || [null, '', '#5F6C86'];
      let name = a.name;
      if (GENERIC.test(name.trim()) && b[1]) name = `${name}, ${b[1]}`;
      if (a.instrument !== 'RUB') name = `${name}, ${Math.round(a.balance).toLocaleString('ru-RU')} ${({ USD: '$', EUR: '€', CNY: '¥' })[a.instrument] || a.instrument}`;
      const letter = (b[1] || a.name.replace(/[^A-Za-zА-Яа-яЁё$₽]/g, '') || '•')[0].toUpperCase();
      // [4] — сайт банка для логотипа: из Zenmoney (company.www), иначе по названию банка
      const site = domainOf(a.bankWww) || (BANK_SITE.find(x => x[0].test(a.bank || '') || x[0].test(a.name)) || [])[1] || '';
      return [name, a.instrument === 'USD' ? '$' : letter, b[2], Math.round(balRub(a)), site];
    })
    .sort((x, y) => y[3] - x[3]);
  const fr = AC.reduce((s, a) => s + a[3], 0);
  const loans = accounts.filter(a => a.type === 'loan');
  const mb = Math.round(-loans.reduce((s, a) => s + balRub(a), 0) * 100) / 100;
  const loanIds = new Set(loans.map(a => a.id));
  const lastPay = [...tx].reverse().find(t => t.inAcc && loanIds.has(t.inAcc) && t.outAcc && !loanIds.has(t.outAcc));
  const mp = lastPay ? r2(lastPay.inAmt) : null;

  /* --- история капитала: остатки на конец месяцев.
     Как в Zenmoney: остаток = стартовый остаток счёта + все операции до даты.
     Исключение — валютные счета: до первой операции они не учитываются (стартовая корректировка
     такого счёта часто введена в рублях и иначе даёт фантомный минус в прошлом). --- */
  const histMonths = allMonths.slice(0, -1);
  const firstOp = {};
  for (const t of tx) for (const a of [t.inAcc, t.outAcc]) if (a && !firstOp[a]) firstOp[a] = t.date;
  const startOf = a => {
    // У кредитов и вкладов API Zenmoney кладёт в startBalance исходную сумму договора (со знаком «плюс»),
    // а не стартовый остаток счёта — для них история восстанавливается назад от текущего остатка.
    if (a.startBalance != null && a.type !== 'loan' && a.type !== 'deposit') return a.startBalance;
    let sum = 0;
    for (const t of tx) { if (t.inAcc === a.id) sum += t.inAmt; if (t.outAcc === a.id) sum -= t.outAmt; }
    return a.balance - sum;
  };
  const running = Object.fromEntries(accounts.map(a => [a.id, startOf(a)]));
  const freeAt = {}, loanAt = {};
  let j = 0;
  for (const m of histMonths) {
    const end = `${m}-31`;
    for (; j < tx.length && tx[j].date <= end; j++) {
      const t = tx[j];
      if (t.inAcc && running[t.inAcc] != null) running[t.inAcc] += t.inAmt;
      if (t.outAcc && running[t.outAcc] != null) running[t.outAcc] -= t.outAmt;
    }
    const at = a => (a.instrument !== 'RUB' && !(firstOp[a.id] && firstOp[a.id] <= end) ? 0 : running[a.id]) * (rates[a.instrument] || 1);
    freeAt[m] = accounts.filter(a => a.inBalance).reduce((s, a) => s + at(a), 0);
    loanAt[m] = -loans.reduce((s, a) => s + at(a), 0);
  }
  const histShown = histMonths.filter(m => m >= winStart);
  const KL = [...histShown.map(m => `${m.slice(5, 7)}.${m.slice(2, 4)}`), dm(today)];
  const FM = [...histShown.map(m => Math.round(freeAt[m] / 1000)), Math.round(fr / 1000)];
  const MM = [...histShown.map(m => Math.round(loanAt[m] / 1000)), Math.round(mb / 1000)];

  /* --- зарплата и поступления текущего месяца --- */
  const salary = incOps.filter(t => ym(t.date) === curM && catName(t.cat) === 'Зарплата');
  const ZP = Math.round(salary.reduce((s, t) => s + incRub(t), 0));
  const INC = Math.round(monInc[curM] || 0);

  /* --- крупные операции без пояснений (корректировки и без категории) за 15 месяцев --- */
  const since = `${addMonth(curM, -15)}-01`;
  const bigUnexplained = expOps.filter(t => t.date >= since && expRub(t) >= BIG_OP && (isCorrection(t) || !categories[t.cat]))
    .map(t => ({ date: t.date, sum: Math.round(expRub(t)), kind: isCorrection(t) ? 'корректировка' : 'без категории' }));

  const lastOp = tx.length ? tx[tx.length - 1].date : today;
  const cm = +curM.slice(5, 7) - 1, pm = +prevM.slice(5, 7) - 1;
  const f3 = FM3.map(m => +m.slice(5, 7) - 1);
  return {
    version: BUILD_VERSION,
    meta: {
      today, curMonth: curM, prevMonth: prevM, pyMonth: pyM, firstDate, lastOp,
      day: +today.slice(8), monthLen: daysIn(curM),
      monName: MN[cm], monGen: MN_GEN[cm], monShort: MN_SHORT[cm], monPrep: MN_PREP[cm], prevName: MN[pm], prevPrep: MN_PREP[pm],
      pyLabel: `${MN_SHORT[cm]} ${pyM.slice(0, 4)}`, pyName: `${MN[cm]} ${pyM.slice(0, 4)}`,
      fm3Label: `${MN[f3[0]]}–${MN[f3[2]]} ${FM3[2].slice(0, 4)}`,
      zpDate: salary.length ? dm(salary[salary.length - 1].date) : dm(today),
      firstDmy: dmy(firstDate), lastDmy: dmy(lastOp), year: Y,
      monStart: shown[0], historyStart: allMonths[0], windowMonths: shown.length,
    },
    TX, HIST, FM3, CATN, INC, ZP,
    SEP: sep.d, SEP_TOT: r2(sep.d.reduce((s, v) => s + v, 0)), SEPCAT: sep.c,
    PY: py.d, PYCAT: py.c, SEP_BIG: bigDaily(prevM), PY_BIG: bigDaily(pyM),
    MS, MON, UT: shown.map(m => Math.round(monUtil[m] || 0)),
    Y_PREV: yearSeries(Y - 1), Y_CUR: yearSeries(Y),
    AC, P: { fr, mb, ...(mp ? { mp } : {}) },
    KL, FM, MM,
    signals: { refunds, bigUnexplained },
  };
}

module.exports = { build, BUILD_VERSION, BIG_OP, BASE_CATN, addMonth, monthsBetween };
