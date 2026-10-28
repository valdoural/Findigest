'use strict';
/**
 * Невидимое служебное окно для работы с PDF и картинками в основном процессе
 * (pdf.js и canvas есть только в окне). Создаётся при первом обращении и закрывается через минуту простоя.
 */
const { BrowserWindow } = require('electron');
const path = require('path');

let win = null, ready = null, idle = null;

function get() {
  clearTimeout(idle);
  idle = setTimeout(() => { if (win) { win.destroy(); win = null; ready = null; } }, 60e3);
  if (ready) return ready;
  win = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { sandbox: true, contextIsolation: true, offscreen: false } });
  ready = win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'tools', 'pdf.html')).then(() => win);
  return ready;
}

/** PDF → {text, pages:[dataURL…], total} — как pdfParts в отчёте. */
async function pdf(buffer) {
  const w = await get();
  return w.webContents.executeJavaScript(`renderPdf(${JSON.stringify(Buffer.from(buffer).toString('base64'))})`);
}

/** Картинка → сжатый JPEG dataURL (ширина до 900 px), как compressImg в отчёте. */
async function image(buffer, mime) {
  const w = await get();
  const url = `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;
  return w.webContents.executeJavaScript(`shrinkImage(${JSON.stringify(url)})`);
}

module.exports = { pdf, image };
