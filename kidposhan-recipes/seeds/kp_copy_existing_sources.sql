-- One-time copy of the registry in the earlier recipe_sources table into kp_recipe_sources.
-- recipe_sources itself is not modified. Safe to re-run (url is unique).
INSERT OR IGNORE INTO kp_recipe_sources (name, platform, region, area, url, notes, active, crawl_mode)
SELECT source_name, platform, region, state_or_area, source_url, notes, active,
       CASE WHEN source_url LIKE '%instagram.com%' OR source_url LIKE '%youtube.com%' THEN 'manual' ELSE 'auto' END
  FROM recipe_sources
 ORDER BY created_at, source_name;
