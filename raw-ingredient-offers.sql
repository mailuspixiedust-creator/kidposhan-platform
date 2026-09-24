-- Raw ingredient ecommerce offers
-- Raw ingredients are NOT scored and are NOT treated as Brand + SKU products.
-- One ingredient can have multiple retailer offers for the same location.

CREATE TABLE IF NOT EXISTS ingredient_offers (
  id TEXT PRIMARY KEY,
  ingredient_key TEXT NOT NULL,
  ingredient_name TEXT NOT NULL,
  product_name TEXT NOT NULL,
  retailer_name TEXT NOT NULL,
  retailer_type TEXT,
  url TEXT NOT NULL,
  affiliate_url TEXT,
  image_url TEXT,
  price REAL,
  currency TEXT NOT NULL DEFAULT 'INR',
  unit_value REAL,
  unit TEXT,
  unit_label TEXT,
  availability_status TEXT,
  location TEXT,
  source_url TEXT,
  evidence_text TEXT,
  checked_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ingredient_offers_key_location
ON ingredient_offers(ingredient_key, location, checked_at);

CREATE INDEX IF NOT EXISTS idx_ingredient_offers_retailer_location
ON ingredient_offers(retailer_name, location, checked_at);
