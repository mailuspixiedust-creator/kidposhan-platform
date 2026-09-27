-- KidPoshan Recipe Intelligence Engine
-- Migration v2
-- Integrates with the EXISTING recipes table.
-- Does not drop, rename, or replace existing recipe data.

-- 1. Add source/provenance fields to the existing recipes table.
ALTER TABLE recipes ADD COLUMN source_id TEXT;
ALTER TABLE recipes ADD COLUMN source_recipe_id TEXT;
ALTER TABLE recipes ADD COLUMN creator_name TEXT;
ALTER TABLE recipes ADD COLUMN creator_type TEXT;
ALTER TABLE recipes ADD COLUMN region TEXT;
ALTER TABLE recipes ADD COLUMN state_or_area TEXT;
ALTER TABLE recipes ADD COLUMN cuisine TEXT;
ALTER TABLE recipes ADD COLUMN source_url TEXT;
ALTER TABLE recipes ADD COLUMN attribution_text TEXT;
ALTER TABLE recipes ADD COLUMN rights_status TEXT;

-- 2. Source registry.
CREATE TABLE IF NOT EXISTS recipe_sources (
  id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  creator_type TEXT,
  region TEXT,
  state_or_area TEXT,
  kids_focus TEXT,
  source_url TEXT NOT NULL,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_sources_name_platform
  ON recipe_sources(source_name, platform);

CREATE INDEX IF NOT EXISTS idx_recipe_sources_region
  ON recipe_sources(region, state_or_area);

CREATE INDEX IF NOT EXISTS idx_recipe_sources_active
  ON recipe_sources(active);

-- 3. Normalized ingredient records for the existing recipes.
CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  ingredient_name TEXT NOT NULL,
  ingredient_key TEXT NOT NULL,
  quantity REAL,
  unit TEXT,
  preparation TEXT,
  ingredient_group TEXT,
  optional INTEGER NOT NULL DEFAULT 0,
  normalized_name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (recipe_id) REFERENCES recipes(id)
);

CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe
  ON recipe_ingredients(recipe_id);

CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_key
  ON recipe_ingredients(ingredient_key);

-- 4. Independent Poshan Score history.
CREATE TABLE IF NOT EXISTS recipe_scores (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  poshan_score REAL NOT NULL,
  score_breakdown_json TEXT,
  scoring_version TEXT NOT NULL,
  scored_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (recipe_id) REFERENCES recipes(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_scores_recipe_version
  ON recipe_scores(recipe_id, scoring_version);

CREATE INDEX IF NOT EXISTS idx_recipe_scores_rank
  ON recipe_scores(poshan_score DESC);

CREATE INDEX IF NOT EXISTS idx_recipe_scores_recipe
  ON recipe_scores(recipe_id);

-- 5. Helpful indexes on the existing recipes table.
CREATE INDEX IF NOT EXISTS idx_recipes_source_id
  ON recipes(source_id);

CREATE INDEX IF NOT EXISTS idx_recipes_region_state
  ON recipes(region, state_or_area);

CREATE INDEX IF NOT EXISTS idx_recipes_meal_season_diet
  ON recipes(meal_moment, season, diet);

CREATE INDEX IF NOT EXISTS idx_recipes_age
  ON recipes(age_min, age_max);
