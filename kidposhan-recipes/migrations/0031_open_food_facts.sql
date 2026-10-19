-- Products imported from Open Food Facts (openfoodfacts.org, Open Database Licence): one product is one barcode, so the same
-- product cannot be added twice. `popularity` is how many people scanned it there (a stand-in for how well known it is).
ALTER TABLE kp_ready_products ADD COLUMN barcode TEXT;
ALTER TABLE kp_ready_products ADD COLUMN data_source TEXT;
ALTER TABLE kp_ready_products ADD COLUMN popularity INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_kp_ready_barcode ON kp_ready_products(barcode) WHERE barcode IS NOT NULL;
