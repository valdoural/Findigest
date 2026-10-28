-- 001: начальная схема. Каждая миграция выполняется один раз; номер версии хранится в meta.schema_version.

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Сохранённое состояние отчёта (цели, параметры, правила, оценки квартиры и т.п.).
-- Совместимо с хранилищем, которым пользовалась веб-версия: коллекция + документ + JSON.
CREATE TABLE IF NOT EXISTS docs (
  collection TEXT NOT NULL,
  id         TEXT NOT NULL,
  json       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (collection, id)
);

-- Архив загруженных чеков и квитанций (без картинок — они лежат файлами в files\archive\<id>\).
CREATE TABLE IF NOT EXISTS archive (
  id         TEXT PRIMARY KEY,
  kind       TEXT,            -- receipt | bill
  status     TEXT,            -- new | parsed | error
  name       TEXT,
  store      TEXT,
  date       TEXT,
  period     TEXT,            -- для квитанций: YYYY-MM
  type       TEXT,            -- для квитанций: УК | ЭСК | ЕРЦ ВС
  total      REAL,
  source     TEXT DEFAULT 'manual', -- manual | mail
  json       TEXT NOT NULL,   -- полная запись (для совместимости с интерфейсом)
  created    TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS archive_files (
  archive_id TEXT NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  field      TEXT NOT NULL,   -- img | pages
  idx        INTEGER NOT NULL,
  path       TEXT NOT NULL,   -- относительно files\archive
  mime       TEXT,
  PRIMARY KEY (archive_id, field, idx)
);

-- Нормализованные позиции чеков — для аналитики, голосового помощника и запросов ИИ.
CREATE TABLE IF NOT EXISTS receipt_items (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  src      TEXT,              -- id записи архива
  date     TEXT,
  store    TEXT,
  name     TEXT,
  sum      REAL,
  grp      TEXT               -- группа продуктов
);
CREATE INDEX IF NOT EXISTS ix_ri_date  ON receipt_items(date);
CREATE INDEX IF NOT EXISTS ix_ri_store ON receipt_items(store);

-- Нормализованные строки квитанций ЖКХ.
CREATE TABLE IF NOT EXISTS bill_items (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  src     TEXT,
  period  TEXT,               -- YYYY-MM
  type    TEXT,               -- УК | ЭСК | ЕРЦ ВС
  name    TEXT,
  qty     REAL,
  rate    REAL,
  sum     REAL
);
CREATE INDEX IF NOT EXISTS ix_bi_period ON bill_items(period);

-- Журнал синхронизаций и фоновых задач.
CREATE TABLE IF NOT EXISTS sync_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  source   TEXT,              -- zenmoney | mail | ai | schedule
  started  TEXT,
  finished TEXT,
  status   TEXT,              -- ok | error
  message  TEXT
);
