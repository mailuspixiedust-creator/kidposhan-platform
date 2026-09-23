PRAGMA foreign_keys = ON;

-- =========================================================
-- PRODUCT IDENTITY
-- Canonical identity = BRAND + SKU
-- Manufacturing location does NOT create a new product.
-- =========================================================

ALTER TABLE discovered_products
ADD COLUMN product_key TEXT;

ALTER TABLE discovered_products
ADD COLUMN variant TEXT;

ALTER TABLE discovered_products
ADD COLUMN identity_status TEXT NOT NULL DEFAULT 'unverified';

CREATE INDEX IF NOT EXISTS idx_discovered_products_product_key
ON discovered_products(product_key);

CREATE INDEX IF NOT EXISTS idx_discovered_products_brand_sku
ON discovered_products(brand, sku);


-- =========================================================
-- MANUFACTURING LOCATIONS
-- One Brand + SKU can have multiple manufacturing locations.
-- =========================================================

CREATE TABLE IF NOT EXISTS product_manufacturing_locations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL
    REFERENCES discovered_products(id)
    ON DELETE CASCADE,

  manufacturer_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  country TEXT DEFAULT 'India',

  source_url TEXT,
  evidence_text TEXT,

  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_product_manufacturing_product
ON product_manufacturing_locations(product_id);


-- =========================================================
-- RETAIL / PURCHASE OFFERS
-- Price and availability belong to an offer, NOT the
-- canonical Brand + SKU product.
-- =========================================================

CREATE TABLE IF NOT EXISTS product_offers (
  id TEXT PRIMARY KEY,

  product_id TEXT NOT NULL
    REFERENCES discovered_products(id)
    ON DELETE CASCADE,

  retailer_name TEXT NOT NULL,
  retailer_type TEXT,

  url TEXT NOT NULL,

  price REAL,
  currency TEXT DEFAULT 'INR',

  pack_size_value REAL,
  pack_size_unit TEXT,

  availability_status TEXT,
  location TEXT,

  affiliate_url TEXT,

  source_url TEXT,
  evidence_text TEXT,

  checked_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_product_offers_product
ON product_offers(product_id);

CREATE INDEX IF NOT EXISTS idx_product_offers_retailer
ON product_offers(retailer_name);

CREATE INDEX IF NOT EXISTS idx_product_offers_location
ON product_offers(location);


-- =========================================================
-- PRODUCT EVIDENCE
-- Keeps individual evidence records separate from the
-- canonical product.
-- =========================================================

CREATE TABLE IF NOT EXISTS product_evidence (
  id TEXT PRIMARY KEY,

  product_id TEXT NOT NULL
    REFERENCES discovered_products(id)
    ON DELETE CASCADE,

  evidence_type TEXT NOT NULL,
  source_url TEXT NOT NULL,

  field_name TEXT,
  extracted_value TEXT,
  evidence_text TEXT,

  confidence REAL,

  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_product_evidence_product
ON product_evidence(product_id);

CREATE INDEX IF NOT EXISTS idx_product_evidence_field
ON product_evidence(product_id, field_name);