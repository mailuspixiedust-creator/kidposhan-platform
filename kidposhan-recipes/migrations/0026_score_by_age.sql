-- Poshan Score version 2: one score per age band (1-3, 4-6, 7-9, 10-12 years), each out of 100 (ten metrics, each 1 to 10).
-- poshan_score stays and now holds the 4-6 year score (the reference band); the four columns let a list be ordered by the child's age.
ALTER TABLE kp_recipes ADD COLUMN score_13 INTEGER;
ALTER TABLE kp_recipes ADD COLUMN score_46 INTEGER;
ALTER TABLE kp_recipes ADD COLUMN score_79 INTEGER;
ALTER TABLE kp_recipes ADD COLUMN score_1012 INTEGER;
