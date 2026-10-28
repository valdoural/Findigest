'use strict';
/**
 * Обычные настройки (config\settings.json). Здесь НЕТ ключей и паролей — они в secrets.json.
 * Новые разделы добавляются в DEFAULTS: недостающие поля подставятся автоматически,
 * поэтому старые файлы настроек продолжают работать после обновлений.
 */
const fs = require('fs');
const { P, writeFileAtomic } = require('../paths');

const DEFAULTS = {
  version: 1,
  firstRunDone: false,
  ai: {
    primary: 'anthropic',          // anthropic | openai | gemini
    fallback: [],                  // резервные провайдеры по порядку, если основной недоступен
    models: {                      // выбирается в «Подключениях» из списка, который отдаёт сам API
      anthropic: 'claude-sonnet-5-5',
      openai: '',
      gemini: '',
    },
    enabled: { anthropic: false, openai: false, gemini: false },
    insights: true,                // выводы ИИ по листам — автоматически после обновления данных
    modelLists: {},
    extra: {},                     // доп. настройки сервисов: { yandex:{folder}, gigachat:{scope}, ollama:{baseUrl}, custom:{baseUrl} }                // списки моделей из API по провайдерам: { id: { at, list:[{id,name,chat}] } } — обновляются раз в сутки
  },
  zenmoney: { enabled: false, lastSync: null, serverTimestamp: 0 },
  mail: {
    enabled: false,
    provider: 'mailru',
    host: 'imap.mail.ru',
    port: 993,
    user: '',                      // адрес почты (пароль — в secrets.json)
    folder: 'INBOX',
    // магазин → адрес отправителя чеков; адрес без @ ищется как часть адреса («ofd» найдёт чеки любого ОФД)
    senders: { 'Магнит': 'info@magnit-family.ru', 'ОФД (любой оператор)': 'ofd' },
    subjectSearch: true,           // искать также по теме письма: «кассовый чек», «электронный чек»…
    depthDays: 90,                 // первая проверка: письма за столько дней
    autoParse: true,               // сразу разбирать загруженные чеки ИИ
    pollMinutes: 30,               // как часто проверять почту, пока программа открыта или в трее (0 — только при «Обновить» и по расписанию)
    lastCheck: null,
    lastResult: null,
  },
  // Прокси для ИИ-сервисов (Claude/GPT/Gemini могут быть недоступны без VPN/прокси в РФ).
  // Пусто = системные настройки Windows. Пример: http://127.0.0.1:8080 или socks5://127.0.0.1:1080
  network: { proxy: '', logos: true },   // logos — загружать логотипы банков и магазинов с их сайтов
  // Обновление данных Zenmoney: при запуске и по расписанию (пока программа открыта или в трее)
  schedule: { mode: 'times', times: ['08:00', '20:00'], everyHours: 3, onStart: true, lastRun: null },
  // Помощник: кто распознаёт речь, чем озвучивать ответы, горячая клавиша (работает и из трея)
  // tts: auto | openai | gemini | yandex | system | off; voices — голос для каждого движка; voice — голос Windows
  assistant: { stt: 'auto', tts: 'auto', voices: {}, voice: '', openaiVoice: 'marin', speak: true, autoStop: true, hotkey: 'CommandOrControl+Shift+Space', globalHotkey: true, ttsV: 2 },
  // Поведение программы: закрытие окна сворачивает в трей (чтобы работало расписание), автозапуск с Windows
  app: { tray: true, autostart: false, skin: '', region: 'Свердловская область' },   // skin — вариант оформления: '' (исходный) | frost | malachite | midnight
  // Обновление программы из GitHub Releases (main/updates.js): репозиторий, автопроверка, предварительные версии
  updates: { owner: '', repo: '', prerelease: false, auto: true, skip: '', lastCheck: null, lastVersion: null },
  ui: { window: { width: 1320, height: 900 } },
};

function merge(def, cur) {
  if (Array.isArray(def)) return Array.isArray(cur) ? cur : def;
  if (def && typeof def === 'object') {
    const out = { ...(cur && typeof cur === 'object' ? cur : {}) };
    for (const k of Object.keys(def)) out[k] = merge(def[k], cur ? cur[k] : undefined);
    return out;
  }
  return cur === undefined ? def : cur;
}

let cache = null;

// Списки, которые пользователь редактирует целиком: удалённое не должно возвращаться из значений по умолчанию
const WHOLE = [['mail', 'senders']];
function keepWhole(out, cur) {
  for (const [a, b] of WHOLE) if (cur && cur[a] && cur[a][b] && typeof cur[a][b] === 'object') out[a][b] = cur[a][b];
  return out;
}

function load() {
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(P.settings, 'utf8')); } catch (_) { /* первый запуск */ }
  cache = keepWhole(merge(DEFAULTS, cur), cur);
  return cache;
}

function get() { return cache || load(); }

function save(next) {
  cache = keepWhole(merge(DEFAULTS, next), next);
  writeFileAtomic(P.settings, JSON.stringify(cache, null, 2));
  return cache;
}

/** Изменить часть настроек: patch('mail', {user:'a@b'}) */
function patch(section, value) {
  const s = get();
  s[section] = typeof value === 'object' && !Array.isArray(value) ? { ...s[section], ...value } : value;
  return save(s);
}

module.exports = { get, save, patch, load, DEFAULTS };
