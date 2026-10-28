-- 002: копия данных Zenmoney для расчёта отчёта без интернета.
-- Заполняется синхронизацией (полной при первом запуске, дальше — только изменения).

CREATE TABLE IF NOT EXISTS zm_instruments (
  id         INTEGER PRIMARY KEY,
  code       TEXT,              -- RUB, USD …
  rate       REAL               -- рублей за единицу
);

CREATE TABLE IF NOT EXISTS zm_companies (
  id    INTEGER PRIMARY KEY,
  title TEXT
);

CREATE TABLE IF NOT EXISTS zm_accounts (
  id            TEXT PRIMARY KEY,
  title         TEXT,
  type          TEXT,           -- cash | ccard | checking | loan | deposit | emoney | debt
  instrument    INTEGER,
  company       INTEGER,
  balance       REAL,
  start_balance REAL,
  credit_limit  REAL,
  in_balance    INTEGER,
  savings       INTEGER,
  archive       INTEGER,
  changed       INTEGER
);

CREATE TABLE IF NOT EXISTS zm_tags (
  id           TEXT PRIMARY KEY,
  title        TEXT,
  parent       TEXT,
  show_income  INTEGER,
  show_outcome INTEGER,
  changed      INTEGER
);

CREATE TABLE IF NOT EXISTS zm_merchants (
  id      TEXT PRIMARY KEY,
  title   TEXT,
  changed INTEGER
);

CREATE TABLE IF NOT EXISTS zm_tx (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  in_acc      TEXT,
  in_amt      REAL,
  out_acc     TEXT,
  out_amt     REAL,
  cat         TEXT,             -- первая метка операции = категория
  tags        TEXT,             -- все метки, JSON
  merchant    TEXT,
  payee       TEXT,
  comment     TEXT,
  hold        INTEGER,
  changed     INTEGER
);
CREATE INDEX IF NOT EXISTS ix_zm_tx_date ON zm_tx(date);
CREATE INDEX IF NOT EXISTS ix_zm_tx_cat  ON zm_tx(cat);
