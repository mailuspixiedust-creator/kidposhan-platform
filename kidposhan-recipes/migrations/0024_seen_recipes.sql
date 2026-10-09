-- Which recipes each browser has already been shown for each filter combination, so a repeat search shows fresh recipes first.
-- vid is the random id the browser keeps (no name, number or IP). Rows older than 60 days are pruned by the background run.
CREATE TABLE IF NOT EXISTS kp_seen (
  vid        TEXT NOT NULL,
  combo      TEXT NOT NULL,          -- world|pref|occasion|season|age band
  recipe_id  INTEGER NOT NULL,
  times      INTEGER NOT NULL DEFAULT 1,
  last_at    INTEGER NOT NULL,       -- unix seconds
  PRIMARY KEY (vid, combo, recipe_id)
);
CREATE INDEX IF NOT EXISTS idx_kp_seen_last ON kp_seen(last_at);
