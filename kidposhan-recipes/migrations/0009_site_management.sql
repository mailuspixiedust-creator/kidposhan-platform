-- KidPoshan: owner's site management (Sites tab).
-- State shown to the owner:  Active = status 'registered' + active 1
--                            Paused = status 'registered' + active 0  (no new reading; published recipes stay)
--                            Blocked = status 'blocked'               (never read; waiting recipes rejected)
--                            New     = status 'suggested'             (found by search, awaiting your decision)
ALTER TABLE kp_recipe_sources ADD COLUMN owner_notes       TEXT;  -- your notes, e.g. "emailed 12 Oct"
ALTER TABLE kp_recipe_sources ADD COLUMN rights_updated_at TEXT;
ALTER TABLE kp_recipe_sources ADD COLUMN state_updated_at  TEXT;
