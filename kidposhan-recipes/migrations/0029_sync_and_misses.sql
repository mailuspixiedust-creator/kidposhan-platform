-- Saved recipes and the weekly plan stay on the phone by default. A parent who wants them on another device proves their mobile
-- number with a one-time code; only then are they stored here, under that verified number.
CREATE TABLE IF NOT EXISTS kp_otp (
  mobile       TEXT PRIMARY KEY,
  code_hash    TEXT NOT NULL,
  expires_at   INTEGER NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  sent_at      INTEGER NOT NULL,
  sent_count   INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kp_sync (
  mobile      TEXT PRIMARY KEY,
  saved_json  TEXT NOT NULL DEFAULT '{}',
  plan_json   TEXT NOT NULL DEFAULT '{}',
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kp_sync_sessions (
  id          TEXT PRIMARY KEY,
  mobile      TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kp_sync_sessions_mobile ON kp_sync_sessions(mobile);
-- What parents search for and we could not find (so the best-known products get scored first).
CREATE TABLE IF NOT EXISTS kp_search_misses (
  term     TEXT PRIMARY KEY,
  n        INTEGER NOT NULL DEFAULT 1,
  last_at  INTEGER NOT NULL
);
