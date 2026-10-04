-- KidPoshan: recipe discovery + catalogue tables.
-- The earlier recipe_sources table (TEXT ids, source_name/source_url) is left untouched.
-- The recipe pipeline uses its own kp_recipe_sources; existing sources are copied in by
-- seeds/kp_copy_existing_sources.sql.
CREATE TABLE IF NOT EXISTS kp_recipe_sources (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT    NOT NULL,
  platform TEXT,
  region   TEXT,
  area     TEXT,
  url      TEXT    NOT NULL,
  notes    TEXT,
  active   INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kp_sources_url ON kp_recipe_sources(url);

-- Rights are tracked per source, separately from registration (registry rule).
-- 'granted' = verbatim method may be displayed on KidPoshan; anything else = link out to source.
ALTER TABLE kp_recipe_sources ADD COLUMN rights_status TEXT NOT NULL DEFAULT 'not_requested';
-- 'auto' = crawlable; 'manual' = Instagram/YouTube etc., recipes captured by hand.
ALTER TABLE kp_recipe_sources ADD COLUMN crawl_mode TEXT NOT NULL DEFAULT 'auto';

UPDATE kp_recipe_sources SET crawl_mode = 'manual'
 WHERE url LIKE '%instagram.com%' OR url LIKE '%youtube.com%';

-- Individual recipe page URLs found from collection pages / Tavily / manual entry.
CREATE TABLE IF NOT EXISTS kp_recipe_candidates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id      INTEGER NOT NULL REFERENCES kp_recipe_sources(id),
  url            TEXT    NOT NULL UNIQUE,
  discovered_via TEXT    NOT NULL,                  -- collection | tavily | manual | self
  status         TEXT    NOT NULL DEFAULT 'pending',-- pending | extracted | partial | not_recipe | error
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  discovered_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  processed_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_kp_candidates_status ON kp_recipe_candidates(status, attempts);

CREATE TABLE IF NOT EXISTS kp_recipes (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id            INTEGER NOT NULL REFERENCES kp_recipe_sources(id),
  source_url           TEXT    NOT NULL UNIQUE,
  name                 TEXT    NOT NULL,
  image_url            TEXT,
  description          TEXT,
  ingredients_raw_json TEXT    NOT NULL,   -- verbatim ingredient lines, as published
  instructions_json    TEXT,               -- verbatim steps: [{section, text}]
  servings             TEXT,
  prep_minutes         INTEGER,
  cook_minutes         INTEGER,
  total_minutes        INTEGER,
  source_rating        REAL,               -- informational only; never feeds Poshan Score
  source_rating_count  INTEGER,
  extraction_method    TEXT    NOT NULL,   -- jsonld | microdata | wprm | tasty | heuristic
  completeness         TEXT    NOT NULL,   -- complete | partial
  diet                 TEXT    NOT NULL,   -- veg | jain | egg | nonveg
  age_min_months       INTEGER NOT NULL,
  age_max_months       INTEGER NOT NULL,
  tag_reasons_json     TEXT,               -- why each tag was applied (auditable)
  poshan_score         REAL,               -- filled by the scoring job; NULL until scored
  review_status        TEXT    NOT NULL DEFAULT 'auto', -- auto | needs_review | approved | rejected
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kp_recipes_filter
  ON kp_recipes(review_status, diet, age_min_months, age_max_months, poshan_score);

CREATE TABLE IF NOT EXISTS kp_recipe_ingredients (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id      INTEGER NOT NULL REFERENCES kp_recipes(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  raw_text       TEXT    NOT NULL,   -- verbatim line
  quantity       REAL,               -- normalized (for nutrition/scoring only)
  unit           TEXT,
  name           TEXT,
  ingredient_key TEXT,               -- same key used by ingredient_offers / live-commerce
  is_pantry      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_kp_ri_recipe ON kp_recipe_ingredients(recipe_id, position);
CREATE INDEX IF NOT EXISTS idx_kp_ri_key    ON kp_recipe_ingredients(ingredient_key);

-- occasion: breakfast | lunchbox | lunch | snack_4pm | dinner
CREATE TABLE IF NOT EXISTS kp_recipe_occasions (
  recipe_id INTEGER NOT NULL REFERENCES kp_recipes(id) ON DELETE CASCADE,
  occasion  TEXT    NOT NULL,
  PRIMARY KEY (recipe_id, occasion)
);
-- season: summer | monsoon | winter | all
CREATE TABLE IF NOT EXISTS kp_recipe_seasons (
  recipe_id INTEGER NOT NULL REFERENCES kp_recipes(id) ON DELETE CASCADE,
  season    TEXT    NOT NULL,
  PRIMARY KEY (recipe_id, season)
);
