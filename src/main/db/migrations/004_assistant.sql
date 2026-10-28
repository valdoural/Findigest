-- 004: представления для голосового помощника (удобные для запросов ИИ) и журнал вопросов.
-- Помощник читает базу только через отдельное подключение «только чтение».

CREATE VIEW IF NOT EXISTS v_base AS
  SELECT COALESCE((SELECT rate FROM zm_instruments WHERE id = CAST((SELECT value FROM meta WHERE key='zm_user_currency') AS INTEGER)), 1) AS rate;

CREATE VIEW IF NOT EXISTS v_accounts AS
  SELECT a.id, a.title AS name, a.type, i.code AS currency, a.balance,
         ROUND(a.balance * COALESCE(i.rate, 1) / (SELECT rate FROM v_base), 2) AS balance_rub,
         a.in_balance, a.savings, a.archive, c.title AS bank
  FROM zm_accounts a
  LEFT JOIN zm_instruments i ON i.id = a.instrument
  LEFT JOIN zm_companies c ON c.id = a.company;

-- Одна строка = одна операция. type: expense | income | transfer. amount_rub — в рублях (по текущему курсу).
CREATE VIEW IF NOT EXISTS v_ops AS
  SELECT t.id, t.date, substr(t.date, 1, 7) AS month,
         CASE WHEN t.in_acc IS NOT NULL AND t.out_acc IS NOT NULL THEN 'transfer'
              WHEN t.out_acc IS NOT NULL THEN 'expense' ELSE 'income' END AS type,
         ROUND(CASE WHEN t.out_acc IS NOT NULL THEN t.out_amt * COALESCE(io.rate, 1)
                    ELSE t.in_amt * COALESCE(ii.rate, 1) END / (SELECT rate FROM v_base), 2) AS amount_rub,
         COALESCE(tg.title, 'Без категории') AS category,
         COALESCE(m.title, NULLIF(t.payee, ''), '') AS payee,
         t.comment,
         ao.title AS from_account, ai.title AS to_account,
         CASE WHEN t.out_acc IS NOT NULL AND t.in_acc IS NULL THEN ao.in_balance
              WHEN t.in_acc IS NOT NULL AND t.out_acc IS NULL THEN ai.in_balance
              ELSE MAX(COALESCE(ao.in_balance, 0), COALESCE(ai.in_balance, 0)) END AS in_balance
  FROM zm_tx t
  LEFT JOIN zm_tags tg ON tg.id = t.cat
  LEFT JOIN zm_merchants m ON m.id = t.merchant
  LEFT JOIN zm_accounts ao ON ao.id = t.out_acc
  LEFT JOIN zm_accounts ai ON ai.id = t.in_acc
  LEFT JOIN zm_instruments io ON io.id = ao.instrument
  LEFT JOIN zm_instruments ii ON ii.id = ai.instrument;

CREATE TABLE IF NOT EXISTS assistant_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL,
  question  TEXT NOT NULL,
  answer    TEXT,
  provider  TEXT,
  queries   TEXT,      -- JSON: какие запросы к базе выполнялись
  voice     INTEGER,   -- 1, если вопрос задан голосом
  ms        INTEGER    -- время ответа
);
