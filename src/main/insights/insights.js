'use strict';
/**
 * Выводы ИИ по листам отчёта (то, что раньше Claude готовил в чате).
 * Один запрос к ИИ → выводы для всех шести листов → сохраняются в БД (docs: insights/latest) и показываются в окне.
 *   • автоматически: после обновления данных, если данные изменились и прошло ≥ 4 ч, и не реже раза в сутки;
 *   • вручную: кнопка «Обновить выводы» на любом листе;
 *   • без ИИ или без данных Zenmoney — не запускается, на листах остаются прежние тексты.
 */
const crypto = require('crypto');
const { BrowserWindow } = require('electron');
const ai = require('../ai/router');
const D = require('../db/database');
const settings = require('../config/settings');
const service = require('../digest/service');
const context = require('../assistant/context');
const log = require('../log');

const SHEETS = {
  sheet1: 'Баланс и цели — расходы текущего месяца против прогноза (медиана трёх месяцев), темп по целям, что делать до конца месяца',
  sheet2: 'Доходы и расходы — разбор последних трёх месяцев: где расходы выросли или снизились и за счёт чего, доля сбережений, какие операции проверить',
  sheet3: 'Имущество — ипотека: остаток, платёж, что выгоднее — досрочное погашение или держать деньги на вкладе (по ставкам из допущений)',
  sheet4: 'Капитал — динамика свободных денег против остатка ипотеки, распределение по счетам, пассивный доход',
  sheet5: 'ЖКХ — изменения начислений и тарифов по квитанциям, пропущенные периоды, что проверить',
  sheet6: 'Продукты — траты на продукты по группам и магазинам, сдвиги относительно прошлых месяцев',
};
const TONES = new Set(['warn', 'good', 'info']);
const AUTO_GAP_MS = 4 * 3600e3, MAX_AGE_MS = 24 * 3600e3;

let running = null;

const r0 = v => Math.round(+v || 0);
function extra() {
  const out = {};
  const d = service.get();
  if (d && d.meta) {
    const months = Object.keys(d.HIST || {}).sort().slice(-4);
    out.расходы_по_категориям_за_месяцы = Object.fromEntries(months.map(m => [m, Object.fromEntries(Object.entries(d.HIST[m]).map(([k, v]) => [k, r0(v)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 12))]));
    const n = d.KL.length, pick = [0, Math.max(0, n - 13), Math.max(0, n - 7), Math.max(0, n - 4), n - 2, n - 1].filter((v, i, a) => v >= 0 && a.indexOf(v) === i);
    out.капитал_история_тыс = pick.map(i => ({ точка: d.KL[i], свободные: d.FM[i], ипотека: d.MM[i] }));
    if (d.Y_PREV && d.Y_CUR) out.расходы_по_месяцам_прошлый_и_текущий_год = { прошлый: d.Y_PREV, текущий: d.Y_CUR };
  }
  try {
    out.продукты_по_группам = D.db.prepare("SELECT substr(date,1,7) m, COALESCE(grp,'Без группы') g, ROUND(SUM(sum)) s FROM receipt_items WHERE date >= date('now','-100 days') GROUP BY m, g ORDER BY m, s DESC").all();
    out.продукты_по_магазинам = D.db.prepare("SELECT store, COUNT(*) позиций, ROUND(SUM(sum)) s FROM receipt_items WHERE date >= date('now','-100 days') GROUP BY store ORDER BY s DESC LIMIT 8").all();
    out.жкх_строки_последних_периодов = D.db.prepare("SELECT period, type, name, qty, rate, sum FROM bill_items WHERE period IN (SELECT DISTINCT period FROM bill_items ORDER BY period DESC LIMIT 3) ORDER BY period DESC, type, sum DESC LIMIT 60").all();
  } catch (_) { /* старая база */ }
  return out;
}

function snapshot() {
  const base = context.build();
  delete base.сегодня;
  return { ...base, ...extra() };
}
const fingerprint = snap => crypto.createHash('sha1').update(JSON.stringify(snap)).digest('hex').slice(0, 16);

function stored() {
  try { const r = D.db.prepare("SELECT json FROM docs WHERE collection='insights' AND id='latest'").get(); return r ? JSON.parse(r.json) : null; }
  catch (_) { return null; }
}
function save(v) {
  D.db.prepare(`INSERT INTO docs(collection,id,json,updated_at) VALUES('insights','latest',?,?)
    ON CONFLICT(collection,id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at`).run(JSON.stringify(v), Date.now());
}
const broadcast = (ch, v) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send(ch, v); };

const SYSTEM = `Ты — финансовый аналитик в настольном приложении «Финансовый дайджест». По данным владельца из Zenmoney,
чеков и квитанций ЖКХ пишешь короткие выводы к листам отчёта. Пиши по-русски, конкретно, с цифрами из данных
(суммы — с пробелами между разрядами и знаком ₽, проценты — целыми). Не выдумывай цифр: если данных для листа нет — верни для него пустой список.
Не давай категоричных инвестиционных рекомендаций: можно показать расчёт и варианты. Не пересказывай очевидное (что и так видно на графике),
а объясняй причины, отклонения и что стоит сделать или проверить.`;

function prompt(snap) {
  return `Данные (JSON):
${JSON.stringify(snap)}

Листы отчёта:
${Object.entries(SHEETS).map(([k, v]) => `${k}: ${v}`).join('\n')}

Для каждого листа дай 2–4 вывода. Каждый вывод: tag — 1–2 слова с заглавной («Расходы», «Проверить», «Цель»),
text — одно-два предложения до 220 символов, tone — "warn" (стоит обратить внимание), "good" (хорошая новость) или "info".
Верни только JSON: {"sheet1":[{"tag":"…","text":"…","tone":"warn"}], "sheet2":[…], "sheet3":[…], "sheet4":[…], "sheet5":[…], "sheet6":[…]}`;
}

function clean(res) {
  const out = {};
  for (const k of Object.keys(SHEETS)) {
    const arr = Array.isArray(res && res[k]) ? res[k] : [];
    out[k] = arr.slice(0, 4).map(x => ({
      tag: String((x && x.tag) || '').trim().slice(0, 40),
      text: String((x && x.text) || '').replace(/\s+/g, ' ').trim().slice(0, 400),
      tone: TONES.has(x && x.tone) ? x.tone : 'info',
    })).filter(x => x.text);
  }
  return out;
}

const hasData = () => { const d = service.get(); return !!(d && d.meta); };
function status() {
  const s = stored();
  return { available: ai.available(), hasData: hasData(), running: !!running, auto: settings.get().ai.insights !== false, ...(s ? { at: s.at, provider: s.provider, sheets: s.sheets, error: s.error || null } : {}) };
}

/** Сгенерировать выводы. force — даже если данные не менялись. */
async function generate({ force = false, reason = 'manual' } = {}) {
  if (running) return running;
  if (!ai.available()) throw Object.assign(new Error('ИИ не подключён: добавьте ключ Claude, Gemini или GPT в «Подключениях»'), { code: 'not_granted' });
  if (!hasData()) throw Object.assign(new Error('Нет данных Zenmoney: выводы появятся после подключения и первого обновления'), { code: 'no_data' });
  const snap = snapshot(), fp = fingerprint(snap), prev = stored();
  if (!force && prev && prev.fp === fp && !prev.error) return status();
  running = (async () => {
    broadcast('insights:state', { running: true });
    const t0 = Date.now();
    try {
      const r = await ai.run({ json: true, system: SYSTEM, prompt: prompt(snap), onWait: ms => broadcast('insights:state', { running: true, waitMs: ms }) });
      const sheets = clean(r.result);
      if (!Object.values(sheets).some(a => a.length)) throw new Error('ИИ вернул пустые выводы');
      save({ at: new Date().toISOString(), provider: r.provider, fp, sheets, reason, ms: Date.now() - t0 });
      log.info(`Выводы ИИ (${r.provider}, ${reason}): ${Date.now() - t0} мс`);
      // ориентиры по региону и РФ: вручную — всегда заново, автоматически — раз в 30 дней (отдельный запрос, ошибка не мешает выводам)
      require('./region').refresh({ auto: reason !== 'manual' }).catch(() => {});
    } catch (e) {
      log.warn('Выводы ИИ:', e.code || '', e.message);
      if (prev) save({ ...prev, error: { message: e.message, at: new Date().toISOString() } });
      throw e;
    } finally {
      running = null;
      broadcast('insights:updated', status());
    }
    return status();
  })();
  return running;
}

/** После обновления данных и при запуске: только если включено, есть ИИ и данные, и выводы устарели. */
function maybeAuto(reason = 'auto') {
  if (settings.get().ai.insights === false || !ai.available() || !hasData() || running) return false;
  const prev = stored();
  const age = prev ? Date.now() - new Date(prev.at).getTime() : Infinity;
  if (prev && age < MAX_AGE_MS) {
    if (age < AUTO_GAP_MS) return false;
    if (prev.fp === fingerprint(snapshot()) && !prev.error) return false;
  }
  generate({ force: true, reason }).catch(() => { /* ошибка уже сохранена и показана на листах */ });
  return true;
}

module.exports = { generate, maybeAuto, status, snapshot, SHEETS, clean };
