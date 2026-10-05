-- KidPoshan: recipe-level Poshan Score + KidPoshan-written steps. Only kp_recipes is altered.
-- poshan_score (existing column) holds the number. score_status says where it came from:
--   exact     = nutrition from the recipe page + added sugar from the listed sweeteners
--   estimated = at least one input estimated from ingredient quantities (hidden from parents until score_approved = 1)
--   pending   = could not be weighed (too many unweighable ingredients)
ALTER TABLE kp_recipes ADD COLUMN nutrition_json        TEXT;                       -- nutrition block published on the source page, if any
ALTER TABLE kp_recipes ADD COLUMN score_status          TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE kp_recipes ADD COLUMN score_breakdown_json  TEXT;                       -- inputs, where each came from, assumptions, engine breakdown
ALTER TABLE kp_recipes ADD COLUMN score_approved        INTEGER NOT NULL DEFAULT 0; -- owner ticks to show an estimated score to parents
ALTER TABLE kp_recipes ADD COLUMN kp_steps_json         TEXT;                       -- steps in KidPoshan's own words: ["step", ...]
ALTER TABLE kp_recipes ADD COLUMN kp_steps_status       TEXT NOT NULL DEFAULT 'none'; -- none | draft | approved
CREATE INDEX IF NOT EXISTS idx_kp_recipes_steps ON kp_recipes(kp_steps_status, review_status);
