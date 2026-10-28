'use strict';
/**
 * Хранилище для интерфейса отчёта.
 * Отчёт обращается к нему как раньше к базе веб-версии (collection → doc → get/set/delete),
 * а здесь эти вызовы раскладываются по таблицам SQLite:
 *   arc_<id>  → таблица archive + файлы картинок на диске
 *   rcp       → docs + нормализованные строки receipt_items
 *   it        → docs + нормализованные строки bill_items
 *   остальное → docs (JSON)
 */
const fs = require('fs');
const path = require('path');
const D = require('./database');
const { P } = require('../paths');

const now = () => Date.now();
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };
const safeId = id => String(id).replace(/[^A-Za-z0-9_.-]/g, '_');

/* ---------- картинки архива: dataURL ⇄ файл ---------- */
function saveDataUrl(archiveId, field, idx, dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || '');
  if (!m) return null;
  const mime = m[1] || 'application/octet-stream';
  const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
  const rel = path.join(safeId(archiveId), `${field}-${idx}.${EXT[mime] || 'bin'}`);
  const abs = path.join(P.archiveDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return { rel, mime };
}
function loadDataUrl(rel, mime) {
  try { return `data:${mime};base64,` + fs.readFileSync(path.join(P.archiveDir, rel)).toString('base64'); }
  catch (_) { return null; }
}

/* ---------- архив ---------- */
function archivePut(e) {
  const db = D.db;
  const meta = { ...e };
  delete meta.img; delete meta.pages;
  D.tx(() => {
    db.prepare(`INSERT INTO archive(id,kind,status,name,store,date,period,type,total,source,json,created,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,status=excluded.status,name=excluded.name,store=excluded.store,
      date=excluded.date,period=excluded.period,type=excluded.type,total=excluded.total,json=excluded.json,updated_at=excluded.updated_at`)
      .run(e.id, e.kind || 'bill', e.status || 'new', e.name || null, e.store || null, e.date || null, e.period || null,
        e.type || null, e.total == null ? null : +e.total, e.source || 'manual', JSON.stringify(meta), e.created || null, now());
    const has = db.prepare('SELECT COUNT(*) n FROM archive_files WHERE archive_id=?').get(e.id).n;
    // картинки неизменны после загрузки: записываем один раз
    if (!has) {
      const ins = db.prepare('INSERT OR REPLACE INTO archive_files(archive_id,field,idx,path,mime) VALUES(?,?,?,?,?)');
      if (e.img) { const f = saveDataUrl(e.id, 'img', 0, e.img); if (f) ins.run(e.id, 'img', 0, f.rel, f.mime); }
      (e.pages || []).forEach((p, i) => { const f = saveDataUrl(e.id, 'pages', i, p); if (f) ins.run(e.id, 'pages', i, f.rel, f.mime); });
    }
  });
}
function archiveGet(id) {
  const r = D.db.prepare('SELECT json FROM archive WHERE id=?').get(id);
  if (!r) return null;
  const e = JSON.parse(r.json);
  const files = D.db.prepare('SELECT field,idx,path,mime FROM archive_files WHERE archive_id=? ORDER BY field,idx').all(id);
  for (const f of files) {
    const url = loadDataUrl(f.path, f.mime);
    if (!url) continue;
    if (f.field === 'img') e.img = url; else (e.pages = e.pages || [])[f.idx] = url;
  }
  return e;
}
function archiveDel(id) {
  D.db.prepare('DELETE FROM archive WHERE id=?').run(id);
  fs.rmSync(path.join(P.archiveDir, safeId(id)), { recursive: true, force: true });
}

/* ---------- нормализация позиций ---------- */
function syncReceiptItems(rcp) {
  const db = D.db;
  D.tx(() => {
    db.exec('DELETE FROM receipt_items');
    const ins = db.prepare('INSERT INTO receipt_items(src,date,store,name,sum,grp) VALUES(?,?,?,?,?,?)');
    for (const x of rcp || []) ins.run(x.src || x.rid || null, x.d || null, x.st || null, x.n || null, +x.s || 0, x.g || null);
  });
}
function syncBillItems(it) {
  const db = D.db;
  D.tx(() => {
    db.exec('DELETE FROM bill_items');
    const ins = db.prepare('INSERT INTO bill_items(src,period,type,name,qty,rate,sum) VALUES(?,?,?,?,?,?,?)');
    for (const x of it || []) ins.run(x.src || null, x.p || null, x.t || null, x.n || null, +x.q || 0, +x.r || 0, +x.s || 0);
  });
}

/* ---------- документы (API, совместимое с веб-версией) ---------- */
function docGet(col, id) {
  if (id.startsWith('arc_')) { const v = archiveGet(id.slice(4)); return v ? { exists: true, data: { v } } : { exists: false }; }
  const r = D.db.prepare('SELECT json FROM docs WHERE collection=? AND id=?').get(col, id);
  return r ? { exists: true, data: JSON.parse(r.json) } : { exists: false };
}
function docSet(col, id, data) {
  if (id.startsWith('arc_')) { archivePut(data && data.v ? data.v : data); return; }
  D.db.prepare(`INSERT INTO docs(collection,id,json,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(collection,id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at`)
    .run(col, id, JSON.stringify(data), now());
  if (id === 'rcp') syncReceiptItems(data && data.v);
  if (id === 'it') syncBillItems(data && data.v);
}
function docDel(col, id) {
  if (id.startsWith('arc_')) { archiveDel(id.slice(4)); return; }
  D.db.prepare('DELETE FROM docs WHERE collection=? AND id=?').run(col, id);
}
function colList(col) {
  const out = D.db.prepare('SELECT id,json FROM docs WHERE collection=?').all(col).map(r => ({ id: r.id, data: JSON.parse(r.json) }));
  for (const r of D.db.prepare('SELECT id FROM archive').all()) {
    const v = archiveGet(r.id);
    if (v) out.push({ id: 'arc_' + r.id, data: { v } });
  }
  return out;
}

function stats() {
  const db = D.db;
  const one = q => db.prepare(q).get().n;
  return {
    file: P.db,
    sizeKb: (() => { try { return Math.round(fs.statSync(P.db).size / 1024); } catch (_) { return 0; } })(),
    receipts: one("SELECT COUNT(*) n FROM archive WHERE kind='receipt'"),
    bills: one("SELECT COUNT(*) n FROM archive WHERE kind<>'receipt'"),
    receiptItems: one('SELECT COUNT(*) n FROM receipt_items'),
    billItems: one('SELECT COUNT(*) n FROM bill_items'),
    schema: +(db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() || {}).value || 0,
  };
}

module.exports = { docGet, docSet, docDel, colList, stats, archivePut, archiveGet };
