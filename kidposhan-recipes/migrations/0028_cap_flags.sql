-- The score columns now hold the REAL total of the ten marks (not clipped at 57). A risk metric at 3 or less holds the rating at Fair;
-- these flags record that per age band, so a capped recipe is never offered as "Good" and carries a "capped" badge.
ALTER TABLE kp_recipes ADD COLUMN cap_13 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kp_recipes ADD COLUMN cap_46 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kp_recipes ADD COLUMN cap_79 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kp_recipes ADD COLUMN cap_1012 INTEGER NOT NULL DEFAULT 0;
-- Backfill from the stored breakdown (each band keeps its real sum and its capped flag).
UPDATE kp_recipes SET
  score_13 = json_extract(score_breakdown_json, '$.bands."1-3".sum'),   cap_13 = COALESCE(json_extract(score_breakdown_json, '$.bands."1-3".capped'), 0),
  score_46 = json_extract(score_breakdown_json, '$.bands."4-6".sum'),   cap_46 = COALESCE(json_extract(score_breakdown_json, '$.bands."4-6".capped'), 0),
  score_79 = json_extract(score_breakdown_json, '$.bands."7-9".sum'),   cap_79 = COALESCE(json_extract(score_breakdown_json, '$.bands."7-9".capped'), 0),
  score_1012 = json_extract(score_breakdown_json, '$.bands."10-12".sum'), cap_1012 = COALESCE(json_extract(score_breakdown_json, '$.bands."10-12".capped'), 0),
  poshan_score = json_extract(score_breakdown_json, '$.bands."4-6".sum')
 WHERE json_extract(score_breakdown_json, '$.bands."4-6".sum') IS NOT NULL;
