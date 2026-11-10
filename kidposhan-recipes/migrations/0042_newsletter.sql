-- The weekly healthy tiffin email: who signed up (double opt-in, one-click unsubscribe) and which recipes went out each week.
CREATE TABLE IF NOT EXISTS kp_subscribers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  band            TEXT NOT NULL DEFAULT '4-6',        -- the child's age group: 1-3, 4-6, 7-9, 10-12
  diet            TEXT NOT NULL DEFAULT 'veg',        -- veg | jain | nonveg
  status          TEXT NOT NULL DEFAULT 'pending',    -- pending (not confirmed) | active | unsubscribed
  token           TEXT NOT NULL,                      -- the secret in the confirm and unsubscribe links
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  consent_at      TEXT,
  confirmed_at    TEXT,
  unsubscribed_at TEXT,
  last_sent_week  TEXT,
  sends           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_kp_subscribers_status ON kp_subscribers(status, last_sent_week);
CREATE TABLE IF NOT EXISTS kp_newsletter_issues (
  week       TEXT NOT NULL,
  band       TEXT NOT NULL,
  diet       TEXT NOT NULL,
  recipe_ids TEXT NOT NULL,
  PRIMARY KEY (week, band, diet)
);
