-- KidPoshan: every photo of the finished dish and its steps, for the photo carousel on the recipe page.
-- images_json is a JSON array of image URLs (hero photo first). NULL = not collected yet; [] = collected, none found.
ALTER TABLE kp_recipes ADD COLUMN images_json TEXT;
