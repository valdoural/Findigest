'use strict';
/**
 * Голосовой (и текстовый) помощник по вашим финансам.
 *   1) ИИ получает вопрос, сводку данных и схему базы. Если сводки хватает — отвечает сразу;
 *      если нужны подробности — просит до трёх SQL-запросов (только чтение).
 *   2) Запросы выполняются локально, результаты уходят ИИ, он формулирует ответ.
 * Ответ двух видов: answer — для экрана (можно с перечнем), speech — 1–2 фразы для озвучки.
 */
const ai = require('../ai/router');
const sql = require('./sql');
const context = require('./context');
const D = require('../db/database');
const log = require('../log');

const SYSTEM = `Ты — помощник в настольном приложении «Финансовый дайджест». Отвечаешь на вопросы владельца о его деньгах
по его данным из Zenmoney, чеков и квитанций ЖКХ. Пиши по-русски, коротко и по делу, суммы — в рублях с пробелами между разрядами
(12 345 ₽). Не выдумывай цифры: используй только сводку и результаты запросов. Если данных нет — так и скажи и подскажи,
что подключить. Не давай категоричных инвестиционных рекомендаций; можно показать расчёт и варианты.`;

const fmtHistory = h => (h || []).slice(-4).map(x => `Вопрос: ${x.q}\nОтвет: ${x.a}`).join('\n\n');

async function ask({ question, voice = false, history = [], reqId } = {}) {
  const q = String(question || '').trim();
  if (!q) throw Object.assign(new Error('Пустой вопрос'), { code: 'empty' });
  const t0 = Date.now();
  const ctx = JSON.stringify(context.build());
  const base = `${SYSTEM}\n\nСводка данных (JSON):\n${ctx}\n\n${sql.SCHEMA}`;
  const hist = fmtHistory(history);

  const step1 = await ai.run({
    reqId, json: true, system: base,
    prompt: `${hist ? 'Предыдущий разговор:\n' + hist + '\n\n' : ''}Вопрос: ${q}

Если сводки достаточно, верни {"answer":"ответ для экрана","speech":"1–2 короткие фразы для озвучки"}.
Если нужны подробности из базы, верни {"queries":[{"why":"что ищем","sql":"SELECT …"}]} — не больше трёх запросов SQLite, только SELECT.`,
  });
  let r = step1.result || {};
  const queries = [];
  if (Array.isArray(r.queries) && r.queries.length && !r.answer) {
    for (const x of r.queries.slice(0, 3)) {
      const item = { why: String(x.why || ''), sql: String(x.sql || '') };
      try { const res = sql.run(item.sql); item.rows = res.rows; item.truncated = res.truncated; }
      catch (e) { item.error = e.message; }
      queries.push(item);
    }
    const step2 = await ai.run({
      reqId, json: true, system: base,
      prompt: `${hist ? 'Предыдущий разговор:\n' + hist + '\n\n' : ''}Вопрос: ${q}

Результаты запросов к базе (JSON):
${JSON.stringify(queries.map(x => ({ why: x.why, sql: x.sql, rows: x.rows, truncated: x.truncated, error: x.error })))}

Сформулируй ответ. Верни {"answer":"ответ для экрана","speech":"1–2 короткие фразы для озвучки"}.`,
    });
    r = step2.result || {};
  }
  const answer = String(r.answer || 'Не получилось сформулировать ответ — попробуйте переформулировать вопрос.').trim();
  const speech = String(r.speech || answer.replace(/\n+/g, ' ').slice(0, 300)).trim();
  const ms = Date.now() - t0;
  try {
    D.db.prepare('INSERT INTO assistant_log(at,question,answer,provider,queries,voice,ms) VALUES(?,?,?,?,?,?,?)')
      .run(new Date().toISOString(), q, answer, step1.provider, JSON.stringify(queries.map(x => ({ why: x.why, sql: x.sql, n: (x.rows || []).length, error: x.error }))), voice ? 1 : 0, ms);
  } catch (e) { log.warn('Журнал помощника:', e.message); }
  return { answer, speech, provider: step1.provider, queries: queries.map(x => ({ why: x.why, sql: x.sql, rows: (x.rows || []).length, error: x.error })), ms };
}

function history(limit = 30) {
  try { return D.db.prepare('SELECT at, question q, answer a FROM assistant_log ORDER BY id DESC LIMIT ?').all(limit).reverse(); }
  catch (_) { return []; }
}
function clearHistory() { D.db.prepare('DELETE FROM assistant_log').run(); }

module.exports = { ask, history, clearHistory };
