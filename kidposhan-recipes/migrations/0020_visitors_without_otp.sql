-- Visitors give a name and mobile number (not verified). They live apart from the main app's users table.
CREATE TABLE IF NOT EXISTS kp_visitors (
  id          TEXT PRIMARY KEY,
  mobile      TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kp_visitor_sessions (
  id          TEXT PRIMARY KEY,
  visitor_id  TEXT NOT NULL REFERENCES kp_visitors(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kp_vsess_created ON kp_visitor_sessions(created_at);
DROP TABLE IF EXISTS kp_otps;
