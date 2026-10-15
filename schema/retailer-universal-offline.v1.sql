-- SUPA universal retailer observations, V1 (offline research only).
-- A product identity is stable; a price is NEVER overwritten into the product.
-- Each price is anchored to a retailer-specific page, timestamp and SHA-256.
PRAGMA foreign_keys = ON;
CREATE TABLE retailer_sources (
  retailer_id TEXT PRIMARY KEY,
  canonical_host TEXT NOT NULL UNIQUE,
  permission_status TEXT NOT NULL CHECK (permission_status IN ('permission_required', 'unresolved', 'permitted', 'prohibited')),
  production_enabled INTEGER NOT NULL DEFAULT 0 CHECK (production_enabled = 0)
);
CREATE TABLE products (
  retailer_id TEXT NOT NULL REFERENCES retailer_sources(retailer_id),
  source_product_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  search_name TEXT NOT NULL,
  PRIMARY KEY (retailer_id, source_product_id)
);
CREATE INDEX products_search_idx ON products(search_name);
CREATE TABLE source_snapshots (
  id INTEGER PRIMARY KEY,
  retailer_id TEXT NOT NULL REFERENCES retailer_sources(retailer_id),
  kind TEXT NOT NULL CHECK (kind IN ('product','catalog','offers')),
  source_url TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  UNIQUE(retailer_id, kind, source_url, content_sha256, captured_at)
);
CREATE INDEX source_snapshots_retailer_time_idx ON source_snapshots(retailer_id, captured_at DESC);
CREATE TABLE price_observations (
  snapshot_id INTEGER NOT NULL REFERENCES source_snapshots(id),
  retailer_id TEXT NOT NULL,
  source_product_id TEXT NOT NULL,
  price_cents INTEGER CHECK(price_cents IS NULL OR price_cents >= 0),
  currency TEXT NOT NULL CHECK (currency = 'EUR'),
  pack_text TEXT,
  pack_amount REAL CHECK (pack_amount IS NULL OR pack_amount > 0),
  pack_unit TEXT NOT NULL CHECK(pack_unit IN ('g','kg','ml','l','piece','pack','unknown')),
  availability TEXT NOT NULL CHECK(availability IN ('available','unavailable','unknown')),
  offer_label TEXT,
  offer_price_cents INTEGER CHECK (offer_price_cents IS NULL OR offer_price_cents >= 0),
  original_price_cents INTEGER CHECK(original_price_cents IS NULL OR original_price_cents >= 0),
  offer_valid_from TEXT,
  offer_valid_to TEXT,
  PRIMARY KEY (snapshot_id, retailer_id, source_product_id),
  FOREIGN KEY(retailer_id, source_product_id) REFERENCES products(retailer_id, source_product_id)
);
CREATE INDEX prices_product_snapshot_idx ON price_observations(retailer_id, source_product_id, snapshot_id);
CREATE TABLE metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO retailer_sources(retailer_id, canonical_host, permission_status, production_enabled)
VALUES
  ('plus', 'www.plus.nl', 'permission_required', 0),
  ('dekamarkt', 'www.dekamarkt.nl', 'unresolved', 0);
INSERT INTO metadata(key, value) VALUES
 ('schema_version', '1'),
 ('origin', 'offline-reviewed-snapshots-only'),
 ('production_enabled', 'false'),
 ('public_savings_claim_eligible', 'false'),
 ('requires_explicit_retailer_license', 'true');
