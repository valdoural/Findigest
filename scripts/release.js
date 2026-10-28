#!/usr/bin/env node
'use strict';
/**
 * Выпуск версии на GitHub Releases — отсюда программа берёт обновления («О программе» → «Обновления»).
 *
 *   set GH_TOKEN=ghp_…            (Windows; токен с правом Contents: Read and write на репозиторий)
 *   npm run release -- --repo владелец/fin-digest
 *
 * Что делает:
 *   1. готовит страницу отчёта (prepare-digest) и собирает установщик (electron-builder);
 *   2. создаёт релиз vX.Y.Z (версия из package.json) и загружает FinDigest-Setup-X.Y.Z.exe, .blockmap и latest.yml
 *      (sha512 установщика — программа сверяет его перед установкой);
 *   3. прикладывает архив исходников FinDigest-src-X.Y.Z.zip (git archive HEAD — без личных данных и сборок).
 * Каждая версия остаётся отдельным релизом: ссылка на последнюю — https://github.com/<владелец>/<репозиторий>/releases/latest.
 * Флаг --dry — только показать, что будет сделано.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const dry = process.argv.includes('--dry');
const spec = arg('--repo') || process.env.FD_GH_REPO || [pkg.fdRelease && pkg.fdRelease.owner, pkg.fdRelease && pkg.fdRelease.repo].filter(Boolean).join('/');
const [owner, repo] = String(spec || '').split('/');
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const version = pkg.version, tag = `v${version}`;
const die = m => { console.error('✗ ' + m); process.exit(1); };

if (!owner || !repo) die('укажите репозиторий: npm run release -- --repo владелец/название (или fdRelease в package.json)');
if (!token && !dry) die('нет токена: задайте переменную GH_TOKEN (Settings → Developer settings → Fine-grained tokens, Contents: Read and write)');

const run = (cmd, args) => { console.log('› ' + [cmd, ...args].join(' ')); if (!dry) execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' }); };
const api = async (url, opts = {}) => {
  const res = await fetch(url, { ...opts, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'fin-digest-release', ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
};

(async () => {
  console.log(`Выпуск ${tag} → github.com/${owner}/${repo}${dry ? ' (пробный прогон)' : ''}`);
  // страница отчёта собирается из веб-версии только там, где она есть (в репозитории её нет — в нём уже готовый index.html)
  if (fs.existsSync(path.join(ROOT, 'reference', 'digest.web.html'))) run('node', ['scripts/prepare-digest.js']);
  else console.log('› reference/digest.web.html нет — беру готовый src/renderer/digest/index.html');
  run('npx', ['electron-builder', '--win', 'nsis', '--x64', '--publish', 'always',
    '-c.publish.provider=github', `-c.publish.owner=${owner}`, `-c.publish.repo=${repo}`, '-c.publish.releaseType=release']);

  // исходники — из закоммиченного состояния, без личных данных и временных файлов
  const zip = path.join(ROOT, 'dist', `FinDigest-src-${version}.zip`);
  run('git', ['archive', '--format=zip', '-o', zip, 'HEAD']);
  if (dry) return console.log(`› загрузить ${path.basename(zip)} в релиз ${tag}`);

  const rel = await api(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`);
  if (!rel.assets.some(a => a.name === path.basename(zip))) {
    const up = rel.upload_url.replace(/\{.*\}$/, '') + `?name=${encodeURIComponent(path.basename(zip))}`;
    await api(up, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: fs.readFileSync(zip) });
  }
  console.log(`✓ Готово: ${rel.html_url}\n  Последняя версия: https://github.com/${owner}/${repo}/releases/latest`);
})().catch(e => die(e.message));
