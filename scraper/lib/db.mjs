import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// node:sqlite is stable enough for us but still prints an ExperimentalWarning.
const originalEmitWarning = process.emitWarning
process.emitWarning = function (warning, ...rest) {
  if (String(warning?.message ?? warning).includes('SQLite')) return
  return originalEmitWarning.call(process, warning, ...rest)
}
const { DatabaseSync } = await import('node:sqlite')

const SCHEMA = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'schema.sql'),
  'utf8',
)

export class ScrapeStore {
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
    this.db.exec(SCHEMA)
    this.stmts = {
      upsertRetailer: this.db.prepare(`
        INSERT INTO retailers(id, name, host, status, notes) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, host = excluded.host,
          status = excluded.status, notes = excluded.notes`),
      startRun: this.db.prepare(
        `INSERT INTO scrape_runs(retailer_id, started_at) VALUES (?, ?) RETURNING id`,
      ),
      finishRun: this.db.prepare(`
        UPDATE scrape_runs SET finished_at = ?, status = ?, pages_fetched = ?,
          products_seen = ?, errors = ?, message = ? WHERE id = ?`),
      findProduct: this.db.prepare(
        `SELECT id FROM products WHERE retailer_id = ? AND source_id = ?`,
      ),
      insertProduct: this.db.prepare(`
        INSERT INTO products(retailer_id, source_id, url, name, brand, gtin, category,
          pack_text, pack_amount, pack_unit, pack_count, image_url, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`),
      updateProduct: this.db.prepare(`
        UPDATE products SET
          url = COALESCE(?, url), name = ?, brand = COALESCE(?, brand),
          gtin = COALESCE(?, gtin), category = COALESCE(?, category),
          pack_text = COALESCE(?, pack_text), pack_amount = COALESCE(?, pack_amount),
          pack_unit = COALESCE(?, pack_unit),
          pack_count = CASE WHEN ? IS NULL THEN pack_count ELSE ? END,
          image_url = COALESCE(?, image_url), last_seen_at = ?
        WHERE id = ?`),
      addGtin: this.db.prepare(
        `INSERT OR IGNORE INTO product_gtins(product_id, gtin) VALUES (?, ?)`,
      ),
      latestPrice: this.db.prepare(`
        SELECT id, price_cents, promo_price_cents, promo_label, promo_valid_until, availability
        FROM prices WHERE product_id = ? ORDER BY last_seen_at DESC, id DESC LIMIT 1`),
      touchPrice: this.db.prepare(
        `UPDATE prices SET last_seen_at = ?, run_id = ? WHERE id = ?`,
      ),
      insertPrice: this.db.prepare(`
        INSERT INTO prices(product_id, run_id, first_seen_at, last_seen_at, price_cents,
          promo_price_cents, promo_label, promo_valid_from, promo_valid_until, availability, source_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    }
  }

  close() {
    this.db.close()
  }

  upsertRetailer({ id, name, host, status, notes }) {
    this.stmts.upsertRetailer.run(id, name, host, status, notes ?? null)
  }

  startRun(retailerId, at = new Date().toISOString()) {
    return Number(this.stmts.startRun.get(retailerId, at).id)
  }

  finishRun(runId, { status, pages = 0, products = 0, errors = 0, message = null }) {
    this.stmts.finishRun.run(
      new Date().toISOString(),
      status,
      pages,
      products,
      errors,
      message,
      runId,
    )
  }

  saveRecord(record, { runId = null, at = new Date().toISOString() } = {}) {
    const s = this.stmts
    const existing = s.findProduct.get(record.retailer, record.sourceId)
    let productId
    if (existing) {
      productId = Number(existing.id)
      s.updateProduct.run(
        record.url,
        record.name,
        record.brand,
        record.gtin,
        record.category,
        record.packText,
        record.packAmount,
        record.packUnit,
        record.packAmount,
        record.packCount ?? 1,
        record.imageUrl,
        at,
        productId,
      )
    } else {
      productId = Number(
        s.insertProduct.get(
          record.retailer,
          record.sourceId,
          record.url,
          record.name,
          record.brand,
          record.gtin,
          record.category,
          record.packText,
          record.packAmount,
          record.packUnit,
          record.packCount ?? 1,
          record.imageUrl,
          at,
          at,
        ).id,
      )
    }
    for (const gtin of [record.gtin, ...(record.extraGtins ?? [])]) {
      if (gtin) s.addGtin.run(productId, gtin)
    }

    const latest = s.latestPrice.get(productId)
    const same =
      latest &&
      latest.price_cents === record.priceCents &&
      latest.promo_price_cents === record.promoPriceCents &&
      latest.promo_label === record.promoLabel &&
      latest.promo_valid_until === record.promoValidUntil &&
      latest.availability === record.availability
    if (same) s.touchPrice.run(at, runId, latest.id)
    else {
      s.insertPrice.run(
        productId,
        runId,
        at,
        at,
        record.priceCents,
        record.promoPriceCents,
        record.promoLabel,
        record.promoValidFrom,
        record.promoValidUntil,
        record.availability,
        record.url,
      )
    }
    return productId
  }

  transaction(fn) {
    this.db.exec('BEGIN')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  all(sql, ...params) {
    return this.db.prepare(sql).all(...params)
  }

  get(sql, ...params) {
    return this.db.prepare(sql).get(...params)
  }
}
