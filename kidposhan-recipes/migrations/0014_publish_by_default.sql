-- KidPoshan: publish by default, review afterwards.
-- A recipe that passes the automatic checks goes live by itself (publish_origin = 'auto', owner_reviewed_at NULL).
-- The owner can then confirm it, edit it, or pull it back. A recipe the owner has decided on (reviewed_at set) is never
-- touched by the automation again. Recipes that fail the checks stay "held", with the reasons stored in hold_reasons_json.
ALTER TABLE kp_recipes ADD COLUMN publish_origin     TEXT;                       -- auto | owner
ALTER TABLE kp_recipes ADD COLUMN auto_published_at  TEXT;
ALTER TABLE kp_recipes ADD COLUMN owner_reviewed_at  TEXT;                       -- NULL = live but not yet looked at by the owner
ALTER TABLE kp_recipes ADD COLUMN hold_reasons_json  TEXT;                       -- why it was not auto-published
ALTER TABLE kp_recipes ADD COLUMN ingredients_edited INTEGER NOT NULL DEFAULT 0; -- owner edited the ingredient lines: re-crawls keep them
ALTER TABLE kp_recipes ADD COLUMN kp_steps_auto      INTEGER NOT NULL DEFAULT 0; -- steps went live without the owner reading them
ALTER TABLE kp_recipes ADD COLUMN score_hidden       INTEGER NOT NULL DEFAULT 0; -- owner switched this recipe's score off
CREATE INDEX IF NOT EXISTS idx_kp_recipes_unreviewed ON kp_recipes(review_status, owner_reviewed_at);

-- Step drafts the AI wrote earlier already passed the "every number and time is kept" check: they go live too.
UPDATE kp_recipes SET kp_steps_status = 'approved', kp_steps_auto = 1 WHERE kp_steps_status = 'draft';
-- Recipes already published by the owner count as reviewed.
UPDATE kp_recipes SET publish_origin = 'owner', owner_reviewed_at = datetime('now') WHERE review_status = 'approved';
