-- How a recipe fits a diet, apart from its Poshan Score: tags like ",fried,whole_grain," (commas on both ends so each can be searched), how often to eat it, and why.
ALTER TABLE kp_recipes ADD COLUMN diet_tags TEXT;
ALTER TABLE kp_recipes ADD COLUMN how_often TEXT;
ALTER TABLE kp_recipes ADD COLUMN how_often_why TEXT;
ALTER TABLE kp_recipes ADD COLUMN diet_checked_at TEXT;
