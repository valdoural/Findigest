'use strict';
/**
 * Конфиденциальные данные — ОТДЕЛЬНЫЙ файл config\secrets.json.
 *
 * • Значения шифруются средствами Windows (DPAPI через Electron safeStorage):
 *   скопированный на другой компьютер или под другую учётную запись файл не расшифруется.
 * • Ключ можно вписать в файл и вручную открытым текстом — при следующем запуске
 *   приложение само его зашифрует (строка получит префикс "enc:").
 * • В окно приложения значения не передаются никогда: интерфейс видит только «задан / не задан»
 *   и последние 4 символа.
 * • Расшифровка выполняется один раз при запуске (load), дальше значения берутся из памяти.
 */
const fs = require('fs');
const { safeStorage } = require('electron');
const { P, writeFileAtomic } = require('../paths');
const log = require('../log');

/** Известные секреты: имя в файле → подпись для человека. */
const KNOWN = {
  anthropic_api_key: 'Claude (Anthropic) — ключ API',
  openai_api_key: 'GPT (OpenAI) — ключ API',
  gemini_api_key: 'Gemini (Google AI Studio) — ключ API',
  zenmoney_token: 'Zenmoney — токен доступа',
  mail_password: 'Почта — пароль для внешних приложений',
  github_token: 'GitHub — токен (нужен только для закрытого репозитория с версиями)',
};

const HEADER = {
  _readme: 'Файл с ключами и паролями Финансового дайджеста. Значения с префиксом enc: зашифрованы Windows. ' +
    'Можно вписать новый ключ открытым текстом в кавычках — приложение зашифрует его при запуске. Никому не пересылайте этот файл.',
};

let mem = {};          // расшифрованные значения — только в памяти основного процесса
let encOk = false;
let writing = Promise.resolve();

async function enc(v) {
  return encOk ? 'enc:' + (await safeStorage.encryptStringAsync(v)).toString('base64') : 'plain:' + v;
}
async function dec(v) {
  if (typeof v !== 'string') return { v: '' };
  if (v.startsWith('enc:')) {
    try {
      const r = await safeStorage.decryptStringAsync(Buffer.from(v.slice(4), 'base64'));
      return { v: r.result, reenc: r.shouldReEncrypt };
    } catch (_) { log.warn('Не удалось расшифровать секрет (файл с другого ПК или другой учётной записи?)'); return { v: '' }; }
  }
  if (v.startsWith('plain:')) return { v: v.slice(6), reenc: encOk };
  return { v, reenc: true }; // вписан вручную открытым текстом
}

function persist() {
  const snapshot = { ...mem };
  writing = writing.then(async () => {
    const out = { ...HEADER };
    for (const [k, v] of Object.entries(snapshot)) if (v) out[k] = await enc(v);
    writeFileAtomic(P.secrets, JSON.stringify(out, null, 2));
  }).catch(e => log.error('Не удалось сохранить secrets.json', e));
  return writing;
}

async function load() {
  try { encOk = await safeStorage.isAsyncEncryptionAvailable(); } catch (_) { encOk = false; }
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(P.secrets, 'utf8')); } catch (_) { /* первый запуск */ }
  mem = {};
  let rewrite = !fs.existsSync(P.secrets);
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('_')) continue;
    const r = await dec(v);
    mem[k] = r.v;
    if (r.reenc) rewrite = true;
  }
  if (rewrite) await persist();
  return mem;
}

const get = name => mem[name] || '';
async function set(name, value) {
  if (value) mem[name] = String(value).trim(); else delete mem[name];
  await persist();
}

/** Только безопасная сводка для интерфейса. */
function status() {
  const out = {};
  for (const [k, label] of Object.entries(KNOWN)) {
    const v = mem[k] || '';
    out[k] = { label, set: !!v, tail: v ? v.slice(-4) : '' };
  }
  return { items: out, encrypted: encOk, file: P.secrets };
}

module.exports = { get, set, load, status, KNOWN };
