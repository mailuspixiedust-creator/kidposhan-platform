-- KidPoshan: nutrition labels read from the pack images (vision model), shown next to the form so the owner can check them.
ALTER TABLE kp_ready_products ADD COLUMN label_image_url TEXT;   -- the pack shot the label was read from
ALTER TABLE kp_ready_products ADD COLUMN label_source    TEXT;   -- pack_image | owner
ALTER TABLE kp_ready_products ADD COLUMN label_tried_at  TEXT;   -- set after the first attempt so a page with no label is not retried forever
ALTER TABLE kp_ready_products ADD COLUMN label_note      TEXT;   -- why it could not be read, or what was inferred
