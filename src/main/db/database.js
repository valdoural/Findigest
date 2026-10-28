'use strict';
/**
 * Локальная база SQLite (data\digest.db).
 * Разворачивается автоматически: при первом запуске файл создаётся, затем по порядку
 * применяются миграции из папки migrations (001_*.sql, 002_*.sql …).
 * Ничего ставить отдельно не нужно — движок SQLite встроен в приложение.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { P } = require('../paths');
const log = require('../log');

let db = null;

function open(file = P.db) {
  if (db) return db;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fresh = !fs.existsSync(file);
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  migrate();
  if (fresh) log.info('База создана:', file);
  return db;
}

function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
  const row = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
  let ver = row ? +row.value : 0;
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    const n = parseInt(f, 10);
    if (n <= ver) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    tx(() => {
      db.exec(sql);
      db.prepare("INSERT INTO meta(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(n));
    });
    ver = n;
    log.info('Миграция применена:', f);
  }
}

/** Транзакция: всё или ничего. */
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

function close() { if (db) { db.close(); db = null; } }

module.exports = { open, tx, close, get db() { return db; } };
