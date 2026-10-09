-- Visitors (mobile + OTP login), star ratings, remarks (admin-approved), UPI support payments, and author outreach tracking.
-- Visitors reuse the existing `users` (mobile column) and `sessions` tables; nothing existing is altered.

CREATE TABLE IF NOT EXISTS kp_otps (
  mobile      TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,          -- unix seconds
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kp_otps_mobile ON kp_otps(mobile, created_at);

CREATE TABLE IF NOT EXISTS kp_ratings (
  recipe_id   INTEGER NOT NULL REFERENCES kp_recipes(id) ON DELETE CASCADE,
  user_id     TEXT    NOT NULL,
  stars       INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (recipe_id, user_id)
);

CREATE TABLE IF NOT EXISTS kp_remarks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id    INTEGER NOT NULL REFERENCES kp_recipes(id) ON DELETE CASCADE,
  user_id      TEXT    NOT NULL,
  display_name TEXT    NOT NULL DEFAULT 'A parent',
  mobile_tail  TEXT,                       -- last 4 digits, for the admin only
  body         TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at   INTEGER NOT NULL,
  reviewed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_kp_remarks_recipe ON kp_remarks(recipe_id, status);
CREATE INDEX IF NOT EXISTS idx_kp_remarks_status ON kp_remarks(status, created_at);

-- A UPI payment is recorded when the visitor says they paid; the admin confirms it against the bank/UPI app.
CREATE TABLE IF NOT EXISTS kp_support_payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id     INTEGER REFERENCES kp_recipes(id) ON DELETE SET NULL,
  user_id       TEXT,
  amount_paise  INTEGER NOT NULL,
  payer_note    TEXT,                      -- UPI transaction / reference id typed by the visitor
  status        TEXT NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed','confirmed','rejected')),
  created_at    INTEGER NOT NULL,
  reviewed_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_kp_pay_status ON kp_support_payments(status, created_at);

-- Author outreach: one row per source site. contact_email is typed in by the owner.
ALTER TABLE kp_recipe_sources ADD COLUMN contact_email TEXT;
CREATE TABLE IF NOT EXISTS kp_outreach (
  source_id     INTEGER PRIMARY KEY REFERENCES kp_recipe_sources(id) ON DELETE CASCADE,
  to_email      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','replied_yes','replied_no','replied_other','bounced','no_reply')),
  gmail_thread  TEXT,
  sent_at       INTEGER,
  replied_at    INTEGER,
  reply_snippet TEXT,
  note          TEXT
);
