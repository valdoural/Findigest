'use strict';
/**
 * Финансовый дайджест — основной процесс.
 * Порядок запуска: папки данных → настройки → секреты → база (с миграциями) → прокси → окно → трей → расписание.
 * При первом запуске открывается мастер настройки, затем — отчёт.
 * Закрытие окна сворачивает программу в трей (если включено), чтобы обновление по расписанию продолжало работать.
 */
const { app, BrowserWindow, Menu, Tray, session, shell, nativeImage, Notification, globalShortcut } = require('electron');
const path = require('path');

app.setName('FinDigest'); // папка данных: %APPDATA%\FinDigest
app.setAppUserModelId('ru.nikolaev.findigest');
const { P } = require('./paths');
const settings = require('./config/settings');
const secrets = require('./config/secrets');
const database = require('./db/database');
const ipc = require('./ipc');
const log = require('./log');

const RENDERER = path.join(__dirname, '..', 'renderer');
const ICON = path.join(__dirname, '..', '..', 'build', 'icon.png');
const startHidden = process.argv.includes('--hidden');
let win = null, tray = null, quitting = false;

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => showWindow());

function contentSecurity() {
  // Окно работает только с локальными файлами приложения; в интернет ходит основной процесс.
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' data: blob:; media-src 'self' blob: mediastream:"],
      },
    });
  });
}

/** Микрофон — только для страниц самого приложения (помощник). */
function permissions() {
  const own = wc => !!(wc && wc.getURL().startsWith('file://'));
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(own(wc) && (perm === 'media' || perm === 'speaker-selection')));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => !!(wc && wc.getURL && wc.getURL().startsWith('file://')) && (perm === 'media' || perm === 'speaker-selection'));
}

/**
 * GigaChat (Сбер) выдаёт токены с сервера на сертификате НУЦ Минцифры («Russian Trusted Root CA»), которого
 * часто нет в Windows. Доверяем такой цепочке ТОЛЬКО для адресов Сбера/GigaChat; всё остальное проверяется как обычно.
 */
function russianTrustedForSber() {
  session.defaultSession.setCertificateVerifyProc((req, cb) => {
    if (req.verificationResult !== 'net::OK' && /(^|\.)(sberbank\.ru|giga\.chat)$/i.test(req.hostname || '')) {
      for (let c = req.certificate, i = 0; c && i < 6; c = c.issuerCert, i++) {
        if (/Russian Trusted (Root|Sub) CA/i.test(c.issuerName || '') || /Russian Trusted (Root|Sub) CA/i.test((c.subject && c.subject.commonName) || '')) return cb(0);
      }
    }
    cb(-3); // решение Chromium по умолчанию
  });
}

/** Горячая клавиша помощника: работает, даже когда окно свёрнуто в трей. */
let hotkey = null;
function applyHotkey() {
  if (hotkey) { try { globalShortcut.unregister(hotkey); } catch (_) { /* уже снята */ } hotkey = null; }
  const a = settings.get().assistant;
  if (!a.globalHotkey || !a.hotkey) return;
  try {
    const okReg = globalShortcut.register(a.hotkey, () => {
      if (!settings.get().firstRunDone) return;
      showWindow();
      if (win) win.webContents.send('assistant:listen');
    });
    if (okReg) hotkey = a.hotkey; else log.warn('Горячая клавиша занята другой программой:', a.hotkey);
  } catch (e) { log.warn('Горячая клавиша не принята:', a.hotkey, e.message); }
}

function createWindow(page, show = true) {
  const w = settings.get().ui.window;
  win = new BrowserWindow({
    width: w.width, height: w.height, minWidth: 420, minHeight: 560,
    title: 'Финансовый дайджест',
    backgroundColor: '#EDF0F7',
    icon: ICON,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => { if (show) win.show(); });
  win.on('close', e => {
    const [width, height] = win.getSize();
    settings.patch('ui', { window: { width, height } });
    if (!quitting && settings.get().app.tray && settings.get().firstRunDone) {
      e.preventDefault();
      win.hide();
      hintTray();
    }
  });
  win.on('closed', () => { win = null; });
  // внешние ссылки — в браузере, а не внутри приложения
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); } });
  win.loadFile(page);
  return win;
}

const DIGEST = () => path.join(RENDERER, 'digest', 'index.html');
function showWindow() {
  if (!win) createWindow(settings.get().firstRunDone ? DIGEST() : path.join(RENDERER, 'wizard', 'index.html'));
  else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
}
const openDigest = () => (win ? win.loadFile(DIGEST()) : createWindow(DIGEST()));

let hinted = false;
function hintTray() {
  if (hinted || !Notification.isSupported()) return;
  hinted = true;
  new Notification({ title: 'Финансовый дайджест работает в фоне', body: 'Значок — в области уведомлений. Обновление по расписанию продолжится. Выход — через меню значка.', icon: ICON }).show();
}

function createTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('Финансовый дайджест');
  const service = require('./digest/service');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Открыть дайджест', click: showWindow },
    { label: service.status().running ? 'Обновление…' : 'Обновить данные сейчас', enabled: !service.status().running, click: () => service.refresh({ reason: 'tray' }).catch(e => log.warn(e.message)) },
    { type: 'separator' },
    { label: 'Выход', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu());
  service.onState(() => { if (tray) tray.setContextMenu(menu()); });
  tray.on('click', showWindow);
}

function applyAutostart() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  app.setLoginItemSettings({ openAtLogin: !!settings.get().app.autostart, args: ['--hidden'] });
}

app.whenReady().then(async () => {
  try {
    P.ensure();
    settings.load();
    { const a = settings.get().assistant; if ((a.ttsV || 1) < 2) settings.patch('assistant', { tts: a.tts === 'system' || !a.tts ? 'auto' : a.tts, openaiVoice: a.openaiVoice === 'alloy' ? 'marin' : a.openaiVoice, ttsV: 2 }); }
    await secrets.load();
    database.open();
  } catch (e) {
    log.error('Ошибка запуска', e);
    const { dialog } = require('electron');
    dialog.showErrorBox('Финансовый дайджест', 'Не удалось подготовить данные: ' + e.message + '\n\nПапка данных: ' + P.root);
    app.quit();
    return;
  }
  Menu.setApplicationMenu(null);
  contentSecurity();
  permissions();
  russianTrustedForSber();
  ipc.register({ onFirstRunDone: openDigest, applyAutostart, applyHotkey });
  await ipc.applyProxy();
  log.info('Запуск', app.getVersion(), 'данные:', P.root);
  const first = !settings.get().firstRunDone;
  createWindow(path.join(RENDERER, first ? 'wizard/index.html' : 'digest/index.html'), !(startHidden && !first));
  createTray();
  applyAutostart();
  require('./scheduler').start();
  applyHotkey();
  // выводы ИИ по листам: если устарели — обновить в фоне, когда окно уже открыто
  setTimeout(() => { try { require('./insights/insights').maybeAuto('start'); } catch (e) { log.warn('Выводы ИИ:', e.message); } }, 20000);
  // проверка новых версий программы на GitHub (если указан репозиторий и включена автопроверка)
  try { require('./updates').schedule(); } catch (e) { log.warn('Обновления:', e.message); }
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {
  if (settings.get().app.tray && settings.get().firstRunDone && !quitting) return; // живём в трее
  database.close();
  app.quit();
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll(); try { database.close(); } catch (_) { /* уже закрыта */ } });
