PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS product_research_cache (
  id TEXT PRIMARY KEY,
  query_key TEXT NOT NULL,
  product_fingerprint TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  gtin TEXT,
  category TEXT NOT NULL DEFAULT '',
  evidence_quality TEXT NOT NULL DEFAULT 'insufficient',
  product_match_confidence TEXT NOT NULL DEFAULT 'low',
  facts_json TEXT NOT NULL DEFAULT '{}',
  source_urls_json TEXT NOT NULL DEFAULT '[]',
  source_notes_json TEXT NOT NULL DEFAULT '[]',
  kidposhan_score REAL,
  score_status TEXT NOT NULL DEFAULT 'not_scored',
  score_version TEXT,
  researched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(query_key, product_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_product_research_query ON product_research_cache(query_key);
CREATE INDEX IF NOT EXISTS idx_product_research_gtin ON product_research_cache(gtin);
CREATE INDEX IF NOT EXISTS idx_product_research_expiry ON product_research_cache(expires_at);

CREATE TABLE IF NOT EXISTS product_research_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  query_text TEXT NOT NULL,
  age REAL,
  meal TEXT,
  season TEXT,
  preference TEXT,
  provider TEXT NOT NULL,
  model TEXT,
  result_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  error_message TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_product_research_runs_created ON product_research_runs(created_at);
