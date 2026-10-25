-- Packs that check out go live on their own; only the ones that look wrong wait for the owner, with the reasons.
ALTER TABLE kp_ready_products ADD COLUMN review_flags TEXT;        -- JSON list of reasons a person should look at this pack
ALTER TABLE kp_ready_products ADD COLUMN auto_checked_at TEXT;     -- set once the rules have looked at it
ALTER TABLE kp_ready_products ADD COLUMN auto_approved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kp_ready_products ADD COLUMN photo_checked_at TEXT;    -- set once the label photo has been read and compared with the stored numbers
