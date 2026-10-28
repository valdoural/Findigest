'use strict';
/**
 * Все пути приложения в одном месте.
 * Программа ставится туда, куда выбрал пользователь в установщике,
 * а данные лежат в профиле пользователя: %APPDATA%\FinDigest\
 *
 *   config\settings.json   — обычные настройки (без секретов)
 *   config\secrets.json    — ключи API и пароли (отдельный файл, шифруется средствами Windows)
 *   data\digest.db         — база SQLite: чеки, квитанции, архив, сохранённые данные отчёта
 *   files\archive\         — оригиналы фото и PDF чеков и квитанций
 *   logs\                  — журнал работы
 */
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const root = () => app.getPath('userData');

const P = {
  get root() { return root(); },
  get configDir() { return path.join(root(), 'config'); },
  get settings() { return path.join(root(), 'config', 'settings.json'); },
  get secrets() { return path.join(root(), 'config', 'secrets.json'); },
  get dataDir() { return path.join(root(), 'data'); },
  get db() { return path.join(root(), 'data', 'digest.db'); },
  get filesDir() { return path.join(root(), 'files'); },
  get archiveDir() { return path.join(root(), 'files', 'archive'); },
  get logsDir() { return path.join(root(), 'logs'); },
  ensure() {
    for (const d of [this.configDir, this.dataDir, this.archiveDir, this.logsDir]) fs.mkdirSync(d, { recursive: true });
  },
};

/** Атомарная запись файла: пишем во временный и переименовываем, чтобы не потерять данные при сбое. */
function writeFileAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

module.exports = { P, writeFileAtomic };
