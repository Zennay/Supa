-- SUPA retailer scrape database (SQLite).
-- Product identity per retailer is stable; every price is a timestamped
-- observation linked to a scrape run. Cross-retailer matching lives in
-- canonical_products + product_matches and can be recomputed at any time.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS retailers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS scrape_runs (
  id INTEGER PRIMARY KEY,
  retailer_id TEXT NOT NULL REFERENCES retailers(id),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  products_seen INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  message TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  retailer_id TEXT NOT NULL REFERENCES retailers(id),
  source_id TEXT NOT NULL,
  url TEXT,
  name TEXT NOT NULL,
  brand TEXT,
  gtin TEXT,
  category TEXT,
  pack_text TEXT,
  pack_amount REAL,
  pack_unit TEXT CHECK (pack_unit IS NULL OR pack_unit IN ('g', 'ml', 'piece')),
  pack_count REAL NOT NULL DEFAULT 1,
  image_url TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (retailer_id, source_id)
);
CREATE INDEX IF NOT EXISTS products_gtin_idx ON products(gtin);

-- Additional barcodes a retailer lists for the same article.
CREATE TABLE IF NOT EXISTS product_gtins (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  gtin TEXT NOT NULL,
  PRIMARY KEY (product_id, gtin)
);
CREATE INDEX IF NOT EXISTS product_gtins_gtin_idx ON product_gtins(gtin);

-- A new row is only written when the observed price facts change; otherwise
-- last_seen_at of the latest row is extended. This keeps full history cheap.
CREATE TABLE IF NOT EXISTS prices (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  run_id INTEGER REFERENCES scrape_runs(id),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  promo_price_cents INTEGER CHECK (promo_price_cents IS NULL OR promo_price_cents >= 0),
  promo_label TEXT,
  promo_valid_from TEXT,
  promo_valid_until TEXT,
  availability TEXT NOT NULL CHECK (availability IN ('available', 'unavailable', 'unknown')),
  source_url TEXT
);
CREATE INDEX IF NOT EXISTS prices_product_idx ON prices(product_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS canonical_products (
  id INTEGER PRIMARY KEY,
  gtin TEXT UNIQUE,
  name TEXT NOT NULL,
  brand TEXT,
  pack_amount REAL,
  pack_unit TEXT,
  pack_count REAL,
  category TEXT
);

CREATE TABLE IF NOT EXISTS product_matches (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  canonical_id INTEGER NOT NULL REFERENCES canonical_products(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('gtin', 'brand-name-pack', 'single')),
  score REAL NOT NULL,
  matched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS product_matches_canonical_idx ON product_matches(canonical_id);

CREATE VIEW IF NOT EXISTS latest_prices AS
SELECT p.id AS product_id, p.retailer_id, p.source_id, p.name, p.brand, p.gtin,
       p.pack_text, p.pack_amount, p.pack_unit, p.pack_count, p.url,
       pr.price_cents, pr.promo_price_cents, pr.promo_label, pr.promo_valid_until,
       COALESCE(pr.promo_price_cents, pr.price_cents) AS effective_price_cents,
       pr.availability, pr.last_seen_at AS observed_at
FROM products p
JOIN prices pr ON pr.id = (
  SELECT id FROM prices WHERE product_id = p.id ORDER BY last_seen_at DESC, id DESC LIMIT 1
);

CREATE VIEW IF NOT EXISTS price_comparison AS
SELECT m.canonical_id, c.name AS canonical_name, c.brand AS canonical_brand, c.gtin,
       c.pack_amount, c.pack_unit, c.pack_count,
       lp.retailer_id, lp.name AS retailer_name, lp.effective_price_cents,
       lp.price_cents, lp.promo_price_cents, lp.promo_label, lp.observed_at, lp.url,
       m.method, m.score
FROM product_matches m
JOIN canonical_products c ON c.id = m.canonical_id
JOIN latest_prices lp ON lp.product_id = m.product_id;
