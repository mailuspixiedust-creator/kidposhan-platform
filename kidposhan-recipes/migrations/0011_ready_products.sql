-- KidPoshan: ready-to-buy packs matched to dishes (e.g. "ragi dosa" -> ragi dosa mix), reviewed by the owner.
-- Separate from the older discovered_products table (strict Brand+SKU identity, untouched).
--   candidate = found by research, waiting in the Packs tab
--   approved  = shown to parents on matching recipe pages
--   rejected  = never shown
-- kidposhan_score is exact-only: computed from the label (per 100 g) the owner enters, with the existing 'packaged' profile.
CREATE TABLE IF NOT EXISTS kp_ready_products (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  kind                 TEXT    NOT NULL,                 -- ready-pack kind, e.g. ragi_dosa_mix (see src/recipes/ready.js)
  name                 TEXT    NOT NULL,
  brand                TEXT,
  sku                  TEXT,
  pack_size            TEXT,
  product_url          TEXT    NOT NULL UNIQUE,
  image_url            TEXT,
  retailer             TEXT,
  ingredients_json     TEXT,
  nutrition_json       TEXT,                             -- per 100 g: protein_g, fibre_g, sugars_g, added_sugars_g, saturated_fat_g, sodium_mg
  kidposhan_score      REAL,
  score_status         TEXT    NOT NULL DEFAULT 'pending', -- pending | exact
  score_breakdown_json TEXT,
  status               TEXT    NOT NULL DEFAULT 'candidate',
  found_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  reviewed_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_kp_ready_kind ON kp_ready_products(status, kind);

-- One row per kind: when research last ran (the cron rotates through the kinds).
CREATE TABLE IF NOT EXISTS kp_ready_research (
  kind        TEXT PRIMARY KEY,
  last_run_at TEXT NOT NULL,
  found       INTEGER NOT NULL DEFAULT 0,
  runs        INTEGER NOT NULL DEFAULT 1
);
