-- Two North Indian recipe sites added as registered sources (parathas, mooli paratha), the recipe pages to read first, and the Bong Eats pages read before the reader could handle their layout.
-- Registered sources are credited and linked on every recipe; the platform's own outreach asks each owner for permission (and a recipe comes down if the owner says no).
INSERT INTO kp_recipe_sources (name, platform, region, area, url, notes, active, crawl_mode, status, world)
SELECT 'nishamadhulika.com', 'Website', 'North India', 'Delhi NCR', 'https://www.nishamadhulika.com/', 'Added by the owner: Punjabi and everyday North Indian home cooking (mooli paratha, parathas). Location of the creator to be confirmed.', 1, 'auto', 'registered', 'india'
WHERE NOT EXISTS (SELECT 1 FROM kp_recipe_sources WHERE url LIKE '%nishamadhulika.com%');
INSERT INTO kp_recipe_sources (name, platform, region, area, url, notes, active, crawl_mode, status, world)
SELECT 'chefkunalkapur.com', 'Website', 'North India', 'Delhi', 'https://www.chefkunalkapur.com/', 'Added by the owner: Punjabi and Delhi style cooking (mooli paratha, laccha paratha).', 1, 'auto', 'registered', 'india'
WHERE NOT EXISTS (SELECT 1 FROM kp_recipe_sources WHERE url LIKE '%chefkunalkapur.com%');
INSERT OR IGNORE INTO kp_recipe_candidates (source_id, url, discovered_via)
SELECT id, 'https://nishamadhulika.com/en/1364-mooli-paratha-punjabi-mooli-ka-paratha-recipe.html', 'manual' FROM kp_recipe_sources WHERE url LIKE '%nishamadhulika.com%' LIMIT 1;
INSERT OR IGNORE INTO kp_recipe_candidates (source_id, url, discovered_via)
SELECT id, 'https://www.nishamadhulika.com/en/2136-mooli_paratha_recipe.html', 'manual' FROM kp_recipe_sources WHERE url LIKE '%nishamadhulika.com%' LIMIT 1;
INSERT OR IGNORE INTO kp_recipe_candidates (source_id, url, discovered_via)
SELECT id, 'https://www.chefkunalkapur.com/?p=2543', 'manual' FROM kp_recipe_sources WHERE url LIKE '%chefkunalkapur.com%' LIMIT 1;
INSERT OR IGNORE INTO kp_recipe_candidates (source_id, url, discovered_via)
SELECT id, 'https://www.chefkunalkapur.com/recipe/laccha-paratha', 'manual' FROM kp_recipe_sources WHERE url LIKE '%chefkunalkapur.com%' LIMIT 1;
INSERT OR IGNORE INTO kp_recipe_candidates (source_id, url, discovered_via)
SELECT id, 'https://www.vegrecipesofindia.com/mooli-paratha-a-punjabi-radish-paratha-recipe/', 'manual' FROM kp_recipe_sources WHERE url LIKE '%vegrecipesofindia.com%' LIMIT 1;
-- the Bong Eats pages that were read as "partial" are read again
UPDATE kp_recipe_candidates SET status = 'pending', attempts = 0 WHERE status = 'partial' AND source_id IN (SELECT id FROM kp_recipe_sources WHERE url LIKE '%bongeats.com%' AND url NOT LIKE '%youtube%');

