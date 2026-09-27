-- KidPoshan Recipe Intelligence Engine
-- Migration: create recipe source, recipe, ingredient and score tables
-- Safe to run with IF NOT EXISTS.

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


CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_recipe_id TEXT,
  title TEXT NOT NULL,
  creator_name TEXT,
  creator_type TEXT,
  region TEXT,
  state_or_area TEXT,
  cuisine TEXT,
  meal_moment TEXT,
  season TEXT,
  diet_type TEXT,
  age_min INTEGER,
  age_max INTEGER,
  kids_suitable INTEGER NOT NULL DEFAULT 0,
  source_url TEXT NOT NULL,
  image_url TEXT,
  description TEXT,
  ingredients_json TEXT,
  instructions_json TEXT,
  nutrition_json TEXT,
  attribution_text TEXT,
  rights_status TEXT,
  status TEXT NOT NULL DEFAULT 'candidate',
  discovered_at INTEGER NOT NULL,
  last_verified INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (source_id) REFERENCES recipe_sources(id)
);

CREATE INDEX IF NOT EXISTS idx_recipes_source
  ON recipes(source_id);

CREATE INDEX IF NOT EXISTS idx_recipes_filters
  ON recipes(meal_moment, season, diet_type, kids_suitable);

CREATE INDEX IF NOT EXISTS idx_recipes_region
  ON recipes(region, state_or_area);

CREATE INDEX IF NOT EXISTS idx_recipes_status
  ON recipes(status);


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
