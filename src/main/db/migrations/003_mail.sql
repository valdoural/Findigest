-- 003: учёт писем, уже загруженных из почты (чтобы чек не попал в архив дважды).

CREATE TABLE IF NOT EXISTS mail_seen (
  key         TEXT PRIMARY KEY,   -- Message-ID письма (или папка+UID, если Message-ID нет)
  folder      TEXT,
  uid         INTEGER,
  date        TEXT,               -- дата письма, ISO
  from_addr   TEXT,
  subject     TEXT,
  archive_ids TEXT,               -- JSON: какие записи архива созданы из письма
  status      TEXT,               -- imported | no_receipt | error
  note        TEXT,
  created     TEXT
);
CREATE INDEX IF NOT EXISTS ix_mail_seen_date ON mail_seen(date);
