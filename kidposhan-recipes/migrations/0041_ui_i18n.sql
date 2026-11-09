-- The words of the pages and apps in Hindi, Bengali and Gujarati: lines of English (numbers written as {#}), their translations, and what failed.
CREATE TABLE IF NOT EXISTS kp_ui_src (
  key        TEXT PRIMARY KEY,
  hits       INTEGER NOT NULL DEFAULT 1,
  first_seen TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kp_ui_src_seen ON kp_ui_src(first_seen);
CREATE TABLE IF NOT EXISTS kp_ui_i18n (
  key        TEXT NOT NULL,
  lang       TEXT NOT NULL,
  tgt        TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'machine',      -- machine | reviewed (a native speaker's wording is never overwritten)
  model      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (key, lang)
);
CREATE TABLE IF NOT EXISTS kp_ui_fail (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  key  TEXT NOT NULL,
  lang TEXT NOT NULL,
  why  TEXT,
  at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kp_ui_fail ON kp_ui_fail(key, lang);
CREATE TABLE IF NOT EXISTS kp_ui_calls (
  day TEXT PRIMARY KEY,
  n   INTEGER NOT NULL DEFAULT 0
);
