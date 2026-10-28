'use strict';
/** Простой журнал в logs\app-YYYY-MM-DD.log. Секреты сюда никогда не пишутся — см. mask(). */
const fs = require('fs');
const path = require('path');
const { P } = require('./paths');

function mask(s) {
  return String(s)
    .replace(/(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, '$1…')
    .replace(/(AIza[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, '$1…')
    .replace(/("?(?:password|token|apiKey|key)"?\s*[:=]\s*"?)[^",\s]+/gi, '$1***');
}

function write(level, args) {
  const line = `${new Date().toISOString()} [${level}] ${mask(args.map(a => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' '))}\n`;
  try {
    fs.mkdirSync(P.logsDir, { recursive: true });
    fs.appendFileSync(path.join(P.logsDir, `app-${new Date().toISOString().slice(0, 10)}.log`), line);
  } catch (_) { /* журнал не должен ронять приложение */ }
  if (level === 'ERR') console.error(line.trim()); else console.log(line.trim());
}

module.exports = {
  info: (...a) => write('INF', a),
  warn: (...a) => write('WRN', a),
  error: (...a) => write('ERR', a),
  mask,
};
