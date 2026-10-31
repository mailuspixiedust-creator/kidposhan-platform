-- Is each pack filed under the right kind of food? A check reads every pack's name and ingredients and moves, or flags, the ones that look misfiled.
ALTER TABLE kp_ready_products ADD COLUMN kind_checked_at TEXT;     -- set once the check has looked at the pack's kind
ALTER TABLE kp_ready_products ADD COLUMN kind_note TEXT;           -- what the check changed, for example: Moved from "Chips" to "Chocolate" by the kind check.
