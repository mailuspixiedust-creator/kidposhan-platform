-- Search by taste ("tangy meal for 9 year"): each recipe's tastes, worked out once from its name and ingredients, so a search is a lookup.
CREATE TABLE IF NOT EXISTS kp_recipe_tastes (
  recipe_id INTEGER NOT NULL,
  taste     TEXT    NOT NULL,      -- tangy | spicy | sweet | creamy | crunchy
  n         INTEGER NOT NULL,      -- how strongly, 1 to 9
  PRIMARY KEY (recipe_id, taste)
);
CREATE INDEX IF NOT EXISTS idx_kp_tastes_taste ON kp_recipe_tastes(taste, n);
ALTER TABLE kp_recipes ADD COLUMN taste_checked_at TEXT;     -- set once the recipe's tastes have been worked out
