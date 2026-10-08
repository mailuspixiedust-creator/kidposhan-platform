-- Unique browsers that have opened a KidPoshan page. A random id kept in the visitor's browser; no name, number or IP is stored.
CREATE TABLE IF NOT EXISTS kp_site_visitors (
  vid         TEXT PRIMARY KEY,
  first_seen  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kp_site_visitors_seen ON kp_site_visitors(first_seen);
