-- KidPoshan Qualitative Quantity Repository v1
-- Master repository for ambiguous recipe quantity phrases.
-- D1 master; Excel/CSV can be generated later for review/export.

CREATE TABLE IF NOT EXISTS qualitative_quantity_terms (
  id TEXT PRIMARY KEY,
  phrase TEXT NOT NULL,
  normalized_phrase TEXT NOT NULL,
  ingredient_key TEXT NOT NULL,
  ingredient_name TEXT NOT NULL,
  context_key TEXT,
  status TEXT NOT NULL DEFAULT 'observed',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_qq_terms_unique
ON qualitative_quantity_terms(normalized_phrase, ingredient_key, COALESCE(context_key, ''));

CREATE TABLE IF NOT EXISTS qualitative_quantity_evidence (
  id TEXT PRIMARY KEY,
  term_id TEXT,
  recipe_id TEXT,
  source_url TEXT,
  source_name TEXT,
  original_text TEXT NOT NULL,
  observed_quantity REAL,
  observed_unit TEXT,
  observed_min REAL,
  observed_max REAL,
  observed_unit_normalized TEXT,
  context_json TEXT,
  evidence_type TEXT NOT NULL DEFAULT 'observed',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_qq_evidence_term
ON qualitative_quantity_evidence(term_id);

CREATE INDEX IF NOT EXISTS idx_qq_evidence_ingredient
ON qualitative_quantity_evidence(original_text);

CREATE TABLE IF NOT EXISTS qualitative_quantity_standards (
  id TEXT PRIMARY KEY,
  term_id TEXT NOT NULL,
  ingredient_key TEXT NOT NULL,
  phrase TEXT NOT NULL,
  min_quantity REAL,
  max_quantity REAL,
  unit TEXT,
  confidence TEXT NOT NULL DEFAULT 'low',
  sample_count INTEGER NOT NULL DEFAULT 0,
  approved INTEGER NOT NULL DEFAULT 0,
  approval_method TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_qq_standards_unique
ON qualitative_quantity_standards(ingredient_key, phrase);

-- Initial KidPoshan-approved convention.
-- "salt to taste" = 1 g salt.
-- Sodium contribution ~= 393 mg using NaCl sodium fraction 0.393.
INSERT OR IGNORE INTO qualitative_quantity_terms
(id, phrase, normalized_phrase, ingredient_key, ingredient_name, context_key, status, created_at, updated_at)
VALUES
('qqt-salt-to-taste', 'to taste', 'to taste', 'salt', 'Salt', NULL, 'approved', strftime('%s','now'), strftime('%s','now'));

INSERT OR IGNORE INTO qualitative_quantity_standards
(id, term_id, ingredient_key, phrase, min_quantity, max_quantity, unit, confidence, sample_count, approved, approval_method, notes, created_at, updated_at)
VALUES
(
  'qqs-salt-to-taste',
  'qqt-salt-to-taste',
  'salt',
  'to taste',
  1,
  1,
  'g',
  'high',
  0,
  1,
  'kidposhan_convention',
  'KidPoshan convention: salt to taste = 1 g salt; sodium contribution ~= 393 mg using NaCl sodium fraction 0.393.',
  strftime('%s','now'),
  strftime('%s','now')
);
