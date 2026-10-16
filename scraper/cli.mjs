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
import { compareApprovedLocalCatalog } from './retailer-compare-approved.mjs'
import { planDailyRefresh } from './daily-refresh.mjs'

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
      if (!adapter) throw new Error('Direct retailer scrape refused: unsupported retailer selection')
      return adapter
    })
  }
  return adapters.filter((a) => a.status === 'active' || opts['include-blocked'])
}

async function scrape() {
  // The standalone scrape CLI is just as capable of doing retailer HTTP as
  // the daily timer. Require both canonical M1 rights and per-store review
  // BEFORE opening SQLite, creating a fetcher or starting Chromium.
  // A policy that approves only Dirk must not authorize the nine-store
  // default command or an explicit extra --retailer argument.
  const policyPath = process.env.SUPA_SCRAPER_POLICY
  if (typeof policyPath !== 'string' || !policyPath.trim()) {
    throw new Error('Direct retailer scrape refused: reviewed policy required')
  }
  let permitted
  try {
    permitted = await planDailyRefresh({
      policyPath,
      sourceGatePath: process.env.SUPA_SOURCE_PERMISSION_GATE ||
        'evidence/m1/source-permission-gate.v1.json',
      now: new Date(),
    })
  } catch {
    throw new Error('Direct retailer scrape refused: source rights unverified')
  }
  // Never interpret or echo raw caller-selected retailer IDs until rights
  // admission succeeds. Even after admission, unsupported IDs remain opaque.
  const selected = selectAdapters()
  if (!selected.length || selected.some(adapter => !permitted.includes(adapter.id))) {
    throw new Error('Direct retailer scrape refused: selected source not approved')
  }
  const store = new ScrapeStore(opts.db)
  for (const u of unsupported) store.upsertRetailer(u)
  const fetcher = new PoliteFetcher({ minDelayMs: Number(opts.delay) })
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

async function compare() {
  const query = positionals.slice(1).join(' ').trim()
  if (!query) throw new Error('usage: compare <search text>')
  // Direct private CLI cannot bypass the same per-retailer permissions and
  // valid price/availability clocks enforced by the localhost search API.
  return compareApprovedLocalCatalog({
    query, dbPath: opts.db,
    policyPath: process.env.SUPA_SCRAPER_POLICY,
    sourceGatePath: process.env.SUPA_SOURCE_PERMISSION_GATE ||
      'evidence/m1/source-permission-gate.v1.json',
  })
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
