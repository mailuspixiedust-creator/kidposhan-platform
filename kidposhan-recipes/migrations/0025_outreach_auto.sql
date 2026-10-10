-- Automatic author outreach: the phone number read from a reply, the reply text, whether the owner has confirmed the reading,
-- where a contact email came from, and on/off settings.
ALTER TABLE kp_outreach ADD COLUMN phone TEXT;
ALTER TABLE kp_outreach ADD COLUMN reply_text TEXT;
ALTER TABLE kp_outreach ADD COLUMN owner_confirmed INTEGER NOT NULL DEFAULT 0;   -- 1 = the owner decided; the automatic reading no longer changes the status
ALTER TABLE kp_recipe_sources ADD COLUMN contact_email_source TEXT;              -- 'owner' (typed in) or 'auto' (found on the site's contact page)
ALTER TABLE kp_recipe_sources ADD COLUMN contact_checked_at TEXT;
CREATE TABLE IF NOT EXISTS kp_settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
