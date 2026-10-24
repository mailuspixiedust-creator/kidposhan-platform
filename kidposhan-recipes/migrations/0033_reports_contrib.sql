-- Mistakes reported by parents, and the people who sent a pack's photos (an email is optional and used only to say thank you).
CREATE TABLE IF NOT EXISTS kp_reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL DEFAULT (datetime('now')),
  product_id INTEGER,
  barcode    TEXT,
  reason     TEXT NOT NULL,            -- name | numbers | photo | other
  note       TEXT,
  email      TEXT,                     -- optional, to say what was done
  who        TEXT,                     -- one-day hash of the connection, to limit floods
  status     TEXT NOT NULL DEFAULT 'open'   -- open | done
);
CREATE INDEX IF NOT EXISTS idx_kp_reports_status ON kp_reports(status, ts);
CREATE TABLE IF NOT EXISTS kp_contrib (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  email      TEXT,
  consent_at TEXT NOT NULL DEFAULT (datetime('now')),
  thanked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_kp_contrib_product ON kp_contrib(product_id);
