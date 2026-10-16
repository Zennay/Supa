#!/usr/bin/env node
// SUPA retailer scraper CLI.
//
//   node scraper/cli.mjs retailers
//   node scraper/cli.mjs scrape [--retailer dirk,spar] [--limit 200] [--db path]
//                               [--delay 1000] [--skip-fresh 20] [--save-html dir]
//   node scraper/cli.mjs match  [--db path]
//   node scraper/cli.mjs stats  [--db path]
//   node scraper/cli.mjs compare "pindakaas" [--db path]
//   node scraper/cli.mjs parse <retailer> <file.html|file.html.gz> [url]
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { parseArgs } from 'node:util'
import { adapters, getAdapter, unsupported } from './adapters/index.mjs'
import { BrowserRenderer } from './lib/browser.mjs'
import { ScrapeStore } from './lib/db.mjs'
import { PoliteFetcher } from './lib/http.mjs'
import { rebuildMatches } from './lib/match.mjs'
import { runRetailer } from './lib/runner.mjs'

const DEFAULT_DB = 'artifacts/scraper/supa-products.sqlite'

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    retailer: { type: 'string' },
    limit: { type: 'string' },
    db: { type: 'string', default: DEFAULT_DB },
    delay: { type: 'string', default: '1000' },
    'skip-fresh': { type: 'string', default: '0' },
    'save-html': { type: 'string' },
    'include-blocked': { type: 'boolean', default: false },
    'no-match': { type: 'boolean', default: false },
  },
})

const command = positionals[0] ?? 'help'
const euro = (cents) => (cents === null || cents === undefined ? '   —   ' : `€${(cents / 100).toFixed(2).padStart(6)}`)

function selectAdapters() {
  if (opts.retailer) {
    return opts.retailer.split(',').map((id) => {
      const adapter = getAdapter(id.trim())
      if (!adapter) throw new Error(`unknown retailer ${id}; see "retailers"`)
      return adapter
    })
  }
  return adapters.filter((a) => a.status === 'active' || opts['include-blocked'])
}

async function scrape() {
  const store = new ScrapeStore(opts.db)
  for (const u of unsupported) store.upsertRetailer(u)
  // A run still marked running belongs to a process that died (container restart, kill).
  store.db.exec(`UPDATE scrape_runs SET status = 'interrupted' WHERE status = 'running'`)
  const fetcher = new PoliteFetcher({ minDelayMs: Number(opts.delay) })
  const selected = selectAdapters()
  const renderer = selected.some((a) => a.mode === 'browser') ? new BrowserRenderer(fetcher) : null
  const log = (msg) => console.error(`${new Date().toISOString()} ${msg}`)
  log(`scraping ${selected.map((a) => a.id).join(', ')} into ${opts.db}`)
  try {
    // Retailers run in parallel; requests to one host are serialised and paced.
    const results = await Promise.all(
      selected.map((adapter) =>
        runRetailer(adapter, {
          store,
          fetcher,
          renderer,
          limit: opts.limit ? Number(opts.limit) : Infinity,
          skipFreshHours: Number(opts['skip-fresh']),
          saveHtmlDir: opts['save-html'] ?? null,
          log,
        }),
      ),
    )
    console.table(results.map(({ retailer, status, pages, products, skipped, errors, message }) => ({ retailer, status, pages, products, skipped, errors, message: message?.slice(0, 80) ?? '' })))
    if (!opts['no-match']) console.log('matching:', rebuildMatches(store))
  } finally {
    await renderer?.close()
    store.close()
  }
}

function stats() {
  const store = new ScrapeStore(opts.db)
  console.table(store.all(`
    SELECT r.id AS retailer, r.status,
      (SELECT count(*) FROM products p WHERE p.retailer_id = r.id) AS products,
      (SELECT count(*) FROM products p WHERE p.retailer_id = r.id AND p.gtin IS NOT NULL) AS with_gtin,
      (SELECT count(*) FROM latest_prices lp WHERE lp.retailer_id = r.id AND lp.price_cents IS NOT NULL) AS priced,
      (SELECT count(*) FROM latest_prices lp WHERE lp.retailer_id = r.id AND lp.promo_price_cents IS NOT NULL) AS promos,
      (SELECT max(finished_at) FROM scrape_runs s WHERE s.retailer_id = r.id) AS last_run
    FROM retailers r ORDER BY products DESC`))
  console.table(store.all(`
    SELECT n AS retailers_per_product, count(*) AS canonical_products FROM (
      SELECT m.canonical_id, count(DISTINCT p.retailer_id) AS n
      FROM product_matches m JOIN products p ON p.id = m.product_id GROUP BY m.canonical_id)
    GROUP BY n ORDER BY n`))
  console.table(store.all('SELECT method, count(*) AS products FROM product_matches GROUP BY method'))
  store.close()
}

function compare() {
  const query = positionals.slice(1).join(' ').trim()
  if (!query) throw new Error('usage: compare <search text>')
  const store = new ScrapeStore(opts.db)
  const like = `%${query.toLowerCase()}%`
  const rows = store.all(
    `SELECT canonical_id, canonical_name, canonical_brand, gtin, retailer_id, retailer_name,
            effective_price_cents, price_cents, promo_label, method, observed_at
     FROM price_comparison
     WHERE canonical_id IN (
       SELECT m.canonical_id FROM product_matches m JOIN products p ON p.id = m.product_id
       WHERE lower(p.name) LIKE ? OR lower(coalesce(p.brand, '')) LIKE ?
       GROUP BY m.canonical_id HAVING count(DISTINCT p.retailer_id) > 1 LIMIT 25)
     ORDER BY canonical_id, effective_price_cents`,
    like,
    like,
  )
  let current = null
  for (const r of rows) {
    if (r.canonical_id !== current) {
      current = r.canonical_id
      console.log(`\n${r.canonical_brand ? r.canonical_brand + ' — ' : ''}${r.canonical_name}${r.gtin ? `  [EAN ${r.gtin}]` : ''}`)
    }
    console.log(`  ${r.retailer_id.padEnd(10)} ${euro(r.effective_price_cents)}${r.promo_label ? `  (${r.promo_label}, normaal ${euro(r.price_cents).trim()})` : ''}  ${r.method}  ${r.retailer_name}`)
  }
  if (!rows.length) console.log('no products found at more than one retailer')
  store.close()
}

function parseFile() {
  const [, id, file, url] = positionals
  const adapter = getAdapter(id)
  if (!adapter || !file) throw new Error('usage: parse <retailer> <file> [url]')
  let buf = readFileSync(file)
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf)
  const html = buf.toString('utf8')
  const pageUrl = url ?? /^<!-- (\S+) -->/.exec(html)?.[1] ?? `https://${adapter.host}/`
  console.log(JSON.stringify(adapter.parse(html, pageUrl), null, 2))
}

function listRetailers() {
  console.table([...adapters, ...unsupported].map(({ id, name, host, status, mode, notes }) => ({ id, name, host, status, mode: mode ?? '', notes })))
}

const commands = {
  scrape,
  match: () => {
    const store = new ScrapeStore(opts.db)
    console.log(rebuildMatches(store))
    store.close()
  },
  stats,
  compare,
  parse: parseFile,
  retailers: listRetailers,
  help: () => console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 12).join('\n').replace(/^\/\/ ?/gm, '')),
}

try {
  if (!commands[command]) throw new Error(`unknown command ${command}`)
  await commands[command]()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
