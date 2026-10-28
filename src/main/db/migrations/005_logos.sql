-- Сайт банка из Zenmoney (company.www) — по нему загружается логотип счёта.
ALTER TABLE zm_companies ADD COLUMN www TEXT;
-- Компании приходят только при изменении: следующая синхронизация будет полной, чтобы получить сайты банков.
UPDATE meta SET value = '0' WHERE key = 'zm_server_ts';
-- Кеш логотипов: домен → картинка (data URL) или пометка «не найден», чтобы не запрашивать заново.
CREATE TABLE IF NOT EXISTS logos (
  domain     TEXT PRIMARY KEY,
  data       TEXT,
  source     TEXT,
  fetched_at INTEGER NOT NULL
);
