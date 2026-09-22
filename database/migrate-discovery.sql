PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS discovery_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  query_text TEXT NOT NULL,
  discovery_type TEXT NOT NULL,
  age INTEGER,
  meal TEXT,
  season TEXT,
  preference TEXT,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'started',
  result_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discovery_runs_user
ON discovery_runs(user_id);

CREATE INDEX IF NOT EXISTS idx_discovery_runs_query
ON discovery_runs(query_text);

CREATE TABLE IF NOT EXISTS discovery_sources (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  domain TEXT,
  title TEXT,
  snippet TEXT,
  content TEXT,
  source_type TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discovery_sources_run
ON discovery_sources(run_id);

CREATE INDEX IF NOT EXISTS idx_discovery_sources_url
ON discovery_sources(url);

CREATE TABLE IF NOT EXISTS discovered_products (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  brand TEXT,
  sku TEXT,
  category TEXT,
  pack_size_value REAL,
  pack_size_unit TEXT,
  manufacturer_url TEXT,
  product_url TEXT,
  ingredients_text TEXT,
  nutrition_json TEXT,
  product_facts_json TEXT,
  evidence_json TEXT,
  availability_json TEXT,
  buy_links_json TEXT,
  confidence REAL,
  kidposhan_score REAL,
  score_status TEXT NOT NULL DEFAULT 'pending',
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discovered_products_run
ON discovered_products(run_id);

CREATE INDEX IF NOT EXISTS idx_discovered_products_sku
ON discovered_products(sku);

CREATE INDEX IF NOT EXISTS idx_discovered_products_score
ON discovered_products(kidposhan_score);

CREATE TABLE IF NOT EXISTS discovered_recipes (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_domain TEXT,
  summary TEXT,
  ingredients_json TEXT,
  age_min INTEGER,
  age_max INTEGER,
  meal TEXT,
  season TEXT,
  preference TEXT,
  image_url TEXT,
  evidence_json TEXT,
  confidence REAL,
  kidposhan_score REAL,
  score_status TEXT NOT NULL DEFAULT 'pending',
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discovered_recipes_run
ON discovered_recipes(run_id);

CREATE INDEX IF NOT EXISTS idx_discovered_recipes_source
ON discovered_recipes(source_url);