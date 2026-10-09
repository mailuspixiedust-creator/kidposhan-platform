-- KidPoshan: publish-by-owner review workflow + search-triggered discovery.
-- After this migration, NOTHING is shown to parents until it is approved in the review screen.

-- review_status is now: pending | approved | rejected
UPDATE kp_recipes SET review_status = 'pending' WHERE review_status IN ('auto', 'needs_review');

ALTER TABLE kp_recipes ADD COLUMN flags_json   TEXT;   -- reasons to look closely, e.g. ["partial","new_site"]
ALTER TABLE kp_recipes ADD COLUMN reviewed_at  TEXT;
ALTER TABLE kp_recipes ADD COLUMN review_note  TEXT;
ALTER TABLE kp_recipes ADD COLUMN found_for    TEXT;   -- the parent search that led to this recipe (query key)

-- Sites found by open-web search land here as 'suggested' (inactive) until approved.
ALTER TABLE kp_recipe_sources ADD COLUMN status          TEXT NOT NULL DEFAULT 'registered'; -- registered | suggested | blocked
ALTER TABLE kp_recipe_sources ADD COLUMN last_crawled_at TEXT;

ALTER TABLE kp_recipe_candidates ADD COLUMN query_key TEXT;

-- One row per filter combination; throttles how often a parent search triggers new discovery.
CREATE TABLE IF NOT EXISTS kp_search_discovery_log (
  query_key      TEXT PRIMARY KEY,      -- pref|occasion|season|ageband
  last_run_at    TEXT NOT NULL,
  runs           INTEGER NOT NULL DEFAULT 1,
  last_found     INTEGER NOT NULL DEFAULT 0,
  last_published INTEGER NOT NULL DEFAULT 0  -- published count at time of run (for the coverage report)
);

CREATE INDEX IF NOT EXISTS idx_kp_recipes_review ON kp_recipes(review_status, created_at);
