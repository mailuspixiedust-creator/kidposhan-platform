-- Which "buy" links people tap (store only; no name, number or IP address), so the owner can see if the pages lead to shopping.
CREATE TABLE IF NOT EXISTS kp_clicks (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  ts    INTEGER NOT NULL,
  vid   TEXT,
  path  TEXT NOT NULL,
  store TEXT NOT NULL,      -- blinkit | zepto | instamart | seller
  what  TEXT                -- the pack or ingredient searched for
);
CREATE INDEX IF NOT EXISTS idx_kp_clicks_ts ON kp_clicks(ts);
