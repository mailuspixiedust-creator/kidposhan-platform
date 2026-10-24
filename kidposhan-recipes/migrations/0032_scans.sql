-- Packs scanned by parents: the barcode, a front and a back photo (shrunk on the phone), and a log of scans used only to limit how
-- many one phone can send in an hour. `who` is a one-day hash of the connection, never the address itself.
CREATE TABLE IF NOT EXISTS kp_scan_photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  side       TEXT    NOT NULL,                 -- front | back
  mime       TEXT    NOT NULL,
  data       TEXT    NOT NULL,                 -- base64
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (product_id, side)
);
CREATE TABLE IF NOT EXISTS kp_scans (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL DEFAULT (datetime('now')),
  who     TEXT,
  kind    TEXT NOT NULL,                       -- lookup | submit
  barcode TEXT
);
CREATE INDEX IF NOT EXISTS idx_kp_scans_who ON kp_scans(who, kind, ts);
