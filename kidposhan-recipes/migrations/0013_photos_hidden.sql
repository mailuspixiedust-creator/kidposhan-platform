-- KidPoshan: dish photos are shown (credited, linked to the original) for every recipe we were allowed to read,
-- unless the owner switches a site's photos off here (e.g. when a creator asks, or a site blocks hot-linking).
ALTER TABLE kp_recipe_sources ADD COLUMN photos_hidden INTEGER NOT NULL DEFAULT 0;
