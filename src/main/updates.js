'use strict';
/**
 * Обновление программы из GitHub Releases.
 *
 * Где лежат версии: каждый выпуск — релиз в репозитории GitHub (тег vX.Y.Z) с установщиком FinDigest-Setup-X.Y.Z.exe,
 * файлом latest.yml (контрольная сумма sha512 от electron-builder) и архивом исходников. Выпускает их `npm run release`
 * (scripts/release.js). Репозиторий по умолчанию берётся из package.json → fdRelease, его можно поменять в «О программе».
 *
 * Что делает модуль: проверяет релизы (при запуске и раз в 12 часов, если включено), сообщает окну о новой версии,
 * скачивает установщик во временную папку с проверкой sha512 и запускает тихую установку поверх с перезапуском
 * программы. Для закрытого репозитория нужен токен GitHub (secrets.json, github_token) — только с правом чтения.
 */
const { app, net, BrowserWindow, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const settings = require('./config/settings');
const secrets = require('./config/secrets');
const log = require('./log');

const PKG = require('../../package.json');
const API = process.env.FD_GH_API || 'https://api.github.com';   // FD_GH_API — только для тестов
const EVERY = 12 * 3600e3;

const cfg = () => {
  const u = settings.get().updates || {};
  const def = PKG.fdRelease || {};
  return { owner: (u.owner || def.owner || '').trim(), repo: (u.repo || def.repo || '').trim(), prerelease: !!u.prerelease, auto: u.auto !== false, skip: u.skip || '' };
};
const configured = c => !!(c.owner && c.repo);
const current = () => (app.isPackaged ? app.getVersion() : PKG.version);
const send = (ch, data) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send(ch, data); };
const err = (code, message) => Object.assign(new Error(message), { code });

/** Сравнение версий 1.2.3 и 1.2.3-beta.1: >0 — a новее. */
function cmp(a, b) {
  const p = v => { const [main, pre = ''] = String(v).replace(/^v/i, '').split('-'); return { n: main.split('.').map(x => +x || 0), pre }; };
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x.n[i] || 0) !== (y.n[i] || 0)) return (x.n[i] || 0) - (y.n[i] || 0);
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1; if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

function headers(accept = 'application/vnd.github+json') {
  const h = { Accept: accept, 'User-Agent': `FinDigest/${current()}`, 'X-GitHub-Api-Version': '2022-11-28' };
  const t = secrets.get('github_token');
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

async function gh(url) {
  let res;
  try { res = await net.fetch(url, { headers: headers() }); }
  catch (e) { throw err('network', 'нет связи с GitHub: ' + e.message); }
  if (res.status === 404) throw err('not_found', 'репозиторий не найден. Проверьте владельца и название; для закрытого репозитория добавьте токен');
  if (res.status === 401) throw err('auth', 'токен GitHub не принят');
  if (res.status === 403 || res.status === 429) {
    const left = res.headers.get('x-ratelimit-remaining');
    throw err('rate_limited', left === '0' ? 'GitHub временно ограничил запросы без токена (60 в час) — повторите позже или добавьте токен' : 'доступ запрещён — проверьте права токена');
  }
  if (!res.ok) throw err('server', `GitHub ответил ${res.status}`);
  return res.json();
}

const pickAsset = (assets, re) => (assets || []).find(a => re.test(a.name));
function shape(r, c) {
  const exe = pickAsset(r.assets, /setup.*\.exe$/i) || pickAsset(r.assets, /\.exe$/i);
  const yml = pickAsset(r.assets, /^latest\.yml$/i);
  const src = pickAsset(r.assets, /src.*\.zip$/i);
  const version = String(r.tag_name || r.name || '').replace(/^v/i, '');
  return {
    version, tag: r.tag_name, name: r.name || r.tag_name, date: r.published_at || r.created_at, url: r.html_url,
    prerelease: !!r.prerelease, notes: String(r.body || '').slice(0, 4000),
    exe: exe ? { name: exe.name, size: exe.size, id: exe.id, url: exe.browser_download_url, api: exe.url } : null,
    yml: yml ? { id: yml.id, url: yml.browser_download_url, api: yml.url } : null,
    src: src ? { name: src.name, url: src.browser_download_url } : { name: 'Исходный код (zip)', url: r.zipball_url ? `https://github.com/${c.owner}/${c.repo}/archive/refs/tags/${r.tag_name}.zip` : null },
  };
}

let last = null, timer = null, busy = null;

/** Проверить релизы. Возвращает сводку для окна; при новой версии рассылает 'updates:available'. */
async function check({ auto = false } = {}) {
  const c = cfg();
  const base = { current: current(), configured: configured(c), owner: c.owner, repo: c.repo, prerelease: c.prerelease, auto: c.auto,
    hasToken: !!secrets.get('github_token'), page: configured(c) ? `https://github.com/${c.owner}/${c.repo}/releases` : null,
    latestPage: configured(c) ? `https://github.com/${c.owner}/${c.repo}/releases/latest` : null };
  if (!base.configured) return (last = { ...base, releases: [], latest: null, newer: false });
  const list = await gh(`${API}/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/releases?per_page=20`);
  const releases = list.filter(r => !r.draft && (c.prerelease || !r.prerelease)).map(r => shape(r, c))
    .filter(r => /^\d+\.\d+/.test(r.version)).sort((a, b) => cmp(b.version, a.version));
  const latest = releases[0] || null;
  const newer = !!(latest && cmp(latest.version, base.current) > 0);
  last = { ...base, releases, latest, newer, checkedAt: new Date().toISOString() };
  settings.patch('updates', { lastCheck: last.checkedAt, lastVersion: latest ? latest.version : null });
  if (newer && latest.exe && !(auto && c.skip === latest.version)) send('updates:available', { version: latest.version, url: latest.url, current: base.current });
  log.info(`Обновления: установлена ${base.current}, последняя ${latest ? latest.version : 'нет релизов'}${newer ? ' — есть новая' : ''}`);
  return last;
}

async function download(url, to, total, onProgress) {
  const res = await net.fetch(url, { headers: headers('application/octet-stream'), redirect: 'follow' });
  if (!res.ok) throw err('server', `скачивание не удалось: ${res.status}`);
  const len = +res.headers.get('content-length') || total || 0;
  const hash = crypto.createHash('sha512');
  const out = fs.createWriteStream(to);
  let got = 0, lastTick = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const b = Buffer.from(value);
    hash.update(b); got += b.length;
    if (!out.write(b)) await new Promise(r => out.once('drain', r));
    if (Date.now() - lastTick > 200) { lastTick = Date.now(); onProgress(got, len); }
  }
  await new Promise((r, j) => out.end(e => (e ? j(e) : r())));
  onProgress(got, len);
  return hash.digest('base64');
}

/** Скачать установщик версии (по умолчанию последней) и проверить контрольную сумму из latest.yml. */
async function fetchInstaller(version) {
  if (busy) return busy;
  busy = (async () => {
    const info = last && last.releases.length ? last : await check();
    const rel = version ? info.releases.find(r => r.version === version) : info.latest;
    if (!rel) throw err('not_found', 'версия не найдена среди релизов');
    if (!rel.exe) throw err('no_asset', 'в релизе нет установщика .exe — выпускайте версии командой npm run release');
    const priv = !!secrets.get('github_token');
    const dir = path.join(app.getPath('temp'), 'FinDigest-update');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, rel.exe.name);
    let expected = null;
    if (rel.yml) {
      try {
        const r = await net.fetch(priv ? rel.yml.api : rel.yml.url, { headers: headers('application/octet-stream'), redirect: 'follow' });
        const y = await r.text();
        const m = y.match(/^sha512:\s*(\S+)/m); if (m) expected = m[1];
      } catch (_) { /* без latest.yml — проверим только размер */ }
    }
    const sha = await download(priv ? rel.exe.api : rel.exe.url, file, rel.exe.size, (got, total) => send('updates:progress', { version: rel.version, got, total }));
    const size = fs.statSync(file).size;
    if (rel.exe.size && size !== rel.exe.size) { fs.rmSync(file, { force: true }); throw err('corrupt', 'файл скачался не полностью — повторите'); }
    if (expected && expected !== sha) { fs.rmSync(file, { force: true }); throw err('corrupt', 'контрольная сумма не совпала — файл повреждён, установка отменена'); }
    log.info(`Обновления: скачан ${rel.exe.name} (${size} байт${expected ? ', sha512 совпал' : ''})`);
    return { file, version: rel.version, verified: !!expected };
  })();
  try { return await busy; } finally { busy = null; }
}

/** Скачать и установить: тихая установка поверх (папка и данные сохраняются), затем программа запустится снова. */
async function install(version) {
  const { file, version: v } = await fetchInstaller(version);
  if (process.platform !== 'win32') { shell.showItemInFolder(file); return { file, started: false }; }
  log.info(`Обновления: запуск установки ${v}`);
  const child = spawn(file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' });
  child.unref();
  setTimeout(() => app.quit(), 600);
  return { file, started: true, version: v };
}

function set(patch) {
  const cur = settings.get().updates || {};
  const next = { ...cur };
  for (const k of ['owner', 'repo']) if (patch[k] != null) next[k] = String(patch[k]).trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
  // «владелец/репозиторий» одной строкой
  if (patch.owner != null && /\//.test(next.owner)) { const [o, r] = next.owner.split('/'); next.owner = o; if (r && !patch.repo) next.repo = r; }
  if (patch.prerelease != null) next.prerelease = !!patch.prerelease;
  if (patch.auto != null) next.auto = !!patch.auto;
  if (patch.skip != null) next.skip = String(patch.skip);
  settings.patch('updates', next);
  last = null;
  schedule();
  return status();
}

const status = () => last || (() => { const c = cfg(); return { current: current(), configured: configured(c), owner: c.owner, repo: c.repo, prerelease: c.prerelease, auto: c.auto, hasToken: !!secrets.get('github_token'), releases: [], latest: null, newer: false,
  page: configured(c) ? `https://github.com/${c.owner}/${c.repo}/releases` : null, latestPage: configured(c) ? `https://github.com/${c.owner}/${c.repo}/releases/latest` : null }; })();

/** Автопроверка: через минуту после запуска и раз в 12 часов, если включена и репозиторий указан. */
function schedule() {
  clearInterval(timer); timer = null;
  const c = cfg();
  if (!c.auto || !configured(c)) return;
  const run = () => check({ auto: true }).catch(e => log.warn('Обновления: ' + e.message));
  setTimeout(run, 60e3).unref?.();
  timer = setInterval(run, EVERY); timer.unref?.();
}

module.exports = { check, install, fetchInstaller, set, status, schedule, cmp };
