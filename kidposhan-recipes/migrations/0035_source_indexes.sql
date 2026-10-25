-- The review, outreach and contact-lookup screens count recipes and candidates per source. Without these indexes every count
-- read the whole table, once per source: tens of thousands of row reads a screen, enough to use up the free daily allowance.
CREATE INDEX IF NOT EXISTS idx_kp_recipes_source ON kp_recipes(source_id, review_status);
CREATE INDEX IF NOT EXISTS idx_kp_candidates_source ON kp_recipe_candidates(source_id, status);
CREATE INDEX IF NOT EXISTS idx_kp_outreach_source ON kp_outreach(source_id);
