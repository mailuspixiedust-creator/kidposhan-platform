-- KidPoshan recipe_sources v4 additions (run after 0006_recipes.sql).
-- Chosen to fill gaps in the v3 registry, which is ~80% school-lunchbox collections:
--   babies/toddlers (6m-3y), Jain, egg/non-veg, and sources with structured data + per-recipe ratings.
-- Targets kp_recipe_sources (see 0006); duplicates by url are skipped.

INSERT OR IGNORE INTO kp_recipe_sources (name, platform, region, area, url, notes, active, crawl_mode) VALUES
('Tarla Dalal - Baby & toddler (6-18 months)', 'Website', 'Pan-India', 'India',
 'https://www.tarladalal.com/recipes-for-babies-1215',
 'Infant/toddler gap. Recipe pages carry JSON-LD with aggregateRating and calories per serving (useful for Poshan Score inputs).', 1, 'auto'),
('Tarla Dalal - Jain recipes', 'Website', 'Pan-India / West', 'India',
 'https://www.tarladalal.com/recipes-for-veg-recipes-jain-34',
 'Jain gap: no onion/garlic/root vegetables; breakfast, snack and tiffin sections.', 1, 'auto'),
('Tarla Dalal - Jain snacks', 'Website', 'Pan-India / West', 'India',
 'https://www.tarladalal.com/jain-snack-recipes/',
 'Jain 4 PM snack coverage; also lists potato substitutes for tiffin tikkis.', 1, 'auto'),
('My Little Moppet - Toddler food chart', 'Website', 'Pan-India', 'India',
 'https://www.mylittlemoppet.com/indian-toddler-food-chart-with-recipes-1/',
 'Toddler breakfast/lunch/dinner/evening-snack chart linking to individual recipes. Covers Breakfast and Dinner, which v3 lacks.', 1, 'auto'),
('My Little Moppet - Egg recipes for babies and kids', 'Website', 'Pan-India', 'India',
 'https://www.mylittlemoppet.com/top-30-egg-recipes-for-babies-and-kids/',
 'Egg/Non-Veg gap. Roundup: some entries link to other sites; crawler keeps same-site links only, add external ones manually after screening.', 1, 'auto'),
('My Little Moppet - Chicken recipes for toddlers', 'Website', 'Pan-India', 'India',
 'https://www.mylittlemoppet.com/20-chicken-recipes-for-toddlers/',
 'Non-Veg gap. Roundup includes non-Indian external recipes; screen before adding.', 1, 'auto'),
('Swasthi''s Recipes - Baby food', 'Website', 'South / Pan-India', 'India',
 'https://www.indianhealthyrecipes.com/indian-baby-food-recipe/',
 'Staged baby food (stage 0-4) with recipe card; site also has toddler-friendly non-veg (e.g. chicken rolls with mild filling).', 1, 'auto'),
('Vege Home Cooking - Jain', 'Website', 'Pan-India', 'India',
 'https://vegehomecooking.com/category/recipes/jain/',
 'Jain breakfast, dal, paneer and rice dishes; good for Jain Lunch/Dinner cells.', 1, 'auto'),
('Cooking and Me - Baby food 6-8 months', 'Website', 'South', 'Tamil Nadu',
 'https://www.cookingandme.com/indian-baby-food-recipes-6-8-months/',
 'Older post (c. 2017) but practical 6-8 month ideas; listicle with short inline methods -> likely heuristic/partial, review.', 1, 'auto');
