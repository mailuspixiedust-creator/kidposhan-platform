-- Which part of the world a recipe site's food comes from: 'india' (the main list), 'asia' ("More Asian recipes") or 'europe' ("European recipes").
-- Every site that exists today is Indian.
ALTER TABLE kp_recipe_sources ADD COLUMN world TEXT NOT NULL DEFAULT 'india';
