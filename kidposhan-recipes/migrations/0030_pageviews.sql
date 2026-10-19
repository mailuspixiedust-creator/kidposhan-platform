-- Page views for the admin Traffic tab: which page, how many real (non-bot) visitors, from which city and country, and how long they stayed.
-- No IP address, name or number is stored. The country and city come from Cloudflare's own lookup at the moment of the visit.
CREATE TABLE IF NOT EXISTS kp_pageviews (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,
  path    TEXT    NOT NULL,
  vid     TEXT,                       -- the random browser id (not personal); null for bots
  country TEXT,
  region  TEXT,
  city    TEXT,
  is_bot  INTEGER NOT NULL DEFAULT 0, -- crawlers, monitors and headless browsers are kept apart and never counted as visitors
  seconds INTEGER,                    -- time the page was on screen, sent when the visitor leaves
  tok     TEXT                        -- secret only that page load knows, so nobody else can set its time
);
CREATE INDEX IF NOT EXISTS idx_kp_pv_ts ON kp_pageviews(ts);
CREATE INDEX IF NOT EXISTS idx_kp_pv_path ON kp_pageviews(path, ts);
