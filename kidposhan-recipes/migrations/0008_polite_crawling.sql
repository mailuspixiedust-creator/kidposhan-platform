-- KidPoshan: robots.txt cache and per-site pacing.
CREATE TABLE IF NOT EXISTS kp_robots_cache (
  origin     TEXT PRIMARY KEY,   -- https://example.com
  body       TEXT,
  status     INTEGER NOT NULL,   -- HTTP status of /robots.txt (599 = unreachable)
  fetched_at INTEGER NOT NULL    -- epoch ms
);
CREATE TABLE IF NOT EXISTS kp_host_pacing (
  host       TEXT PRIMARY KEY,
  next_ok_at INTEGER NOT NULL    -- epoch ms before which we don't request this host again
);
-- candidates the site asked us to come back to later (pacing); NULL = ready
ALTER TABLE kp_recipe_candidates ADD COLUMN not_before INTEGER;
