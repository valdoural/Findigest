'use strict';
/**
 * Обновление по расписанию.
 *   schedule.mode: 'off' | 'times' | 'interval'
 *   schedule.times: ['08:00','20:00']  — в эти часы каждый день
 *   schedule.everyHours: 3             — для режима interval
 *   schedule.onStart: true             — обновлять при запуске программы
 * Пропущенный запуск (компьютер спал) выполняется сразу после пробуждения.
 * Работает, пока программа запущена (в том числе свёрнутая в трей).
 */
const { powerMonitor } = require('electron');
const settings = require('./config/settings');
const service = require('./digest/service');
const log = require('./log');

let timer = null, mailTimer = null, mailLast = 0;

function sched() { return settings.get().schedule; }
/** Время прошлого запуска по расписанию (успешного или нет — чтобы при ошибке не повторять каждые 30 секунд). */
const lastRun = () => sched().lastRun || settings.get().zenmoney.lastSync || null;

/** Ближайший запуск после момента from. */
function nextAfter(from = new Date()) {
  const s = sched();
  if (s.mode === 'interval') {
    const lr = lastRun();
    const last = lr ? new Date(lr) : null;
    const step = Math.max(1, +s.everyHours || 3) * 3600e3;
    const n = last ? new Date(last.getTime() + step) : from;
    return n < from ? from : n;
  }
  if (s.mode === 'times') {
    const list = (s.times || []).map(t => /^(\d{1,2}):(\d{2})$/.exec(String(t).trim())).filter(Boolean).map(m => [+m[1], +m[2]]);
    if (!list.length) return null;
    let best = null;
    for (let d = 0; d < 2; d++) for (const [h, m] of list) {
      const c = new Date(from); c.setDate(c.getDate() + d); c.setHours(h, m, 0, 0);
      if (c > from && (!best || c < best)) best = c;
    }
    return best;
  }
  return null;
}

/** Был ли пропущен запуск между прошлой синхронизацией и сейчас. */
function missed(now = new Date()) {
  const last = lastRun();
  if (!last) return sched().mode !== 'off';
  const n = nextAfter(new Date(last));
  return !!(n && n <= now);
}

async function run(reason) {
  const st = service.status();
  if (!st.anySource || st.running) return;
  settings.patch('schedule', { lastRun: new Date().toISOString() });
  try { await service.refresh({ reason }); log.info('Обновление по расписанию выполнено:', reason); }
  catch (e) { log.warn('Обновление по расписанию не удалось:', e.message); }
}

function tick() { if (sched().mode !== 'off' && missed()) run('schedule'); mailTick(); }

/** Почта — чаще общего расписания: новые чеки попадают в отчёт в течение pollMinutes после прихода письма. */
async function mailTick() {
  const every = +settings.get().mail.pollMinutes || 0;
  if (!every || Date.now() - mailLast < every * 60e3) return;
  const st = service.status();
  if (!st.mail || !st.mail.connected || st.running) return;
  mailLast = Date.now();
  try { await service.refresh({ only: 'mail', reason: 'mail-poll' }); }
  catch (e) { log.warn('Проверка почты не удалась:', e.message); }
}

function start() {
  stop();
  timer = setInterval(tick, 30e3);
  powerMonitor.on('resume', () => setTimeout(tick, 15e3));
  if (sched().onStart) { mailLast = Date.now(); setTimeout(() => run('start'), 5e3); }
}
function stop() { if (timer) clearInterval(timer); timer = null; }

function describe() {
  const n = sched().mode === 'off' ? null : nextAfter();
  return { ...sched(), next: n ? n.toISOString() : null };
}

module.exports = { start, stop, describe, nextAfter };
