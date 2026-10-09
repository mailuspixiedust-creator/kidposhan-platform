-- Pixel width of each recipe's hero photo (NULL = not measured yet, 0 = could not be measured).
-- Used to show recipes with sharper photos first.
ALTER TABLE kp_recipes ADD COLUMN image_w INTEGER;
