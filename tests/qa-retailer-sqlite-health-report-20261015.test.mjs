import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildReviewedRetailerSqlite } from '../scripts/retailer-build-reviewed-universal-sqlite.mjs'

// True offline six-fixture/SQLite review. Reports counts only; never price
// amounts, retailer source URL, product names or unlicensed public claims.
const cli = new URL('../scripts/qa-retailer-sqlite-health-report.py', import.meta.url).pathname
const py = args => spawnSync('python3', args, { encoding: 'utf8', timeout: 25_000, maxBuffer: 1024 * 1024 })
const asOf = '2026-10-15T00:00:00Z'
const read = (db, clock = asOf) => py([cli, '--database', db, '--as-of', clock])
const update = (db, sql) => py(['-c',
  'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(sys.argv[2]); c.commit(); c.close()',db,sql])
async function withDb(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-retail-health-'))
  const db = join(dir, 'pilot.db')
  try { await buildReviewedRetailerSqlite(db); await fn(db, dir) }
  finally { await rm(dir, { force: true, recursive: true }) }
}
function refused(output) {
  assert.equal(output.status, 2)
  assert.equal(output.stdout, '')
  assert.match(output.stderr, /^Historical retailer QA health report refused\s*$/)
  assert.doesNotMatch(output.stderr, /\/tmp\/|https?:\/\/|pilot\.db|FAKE_SECRET/)
}

test('real six-source historical quality counts identify stale snapshots without publishing a current price', () => withDb(async (db, dir) => {
  const before = await readFile(db)
  const outcome = read(db)
  assert.equal(outcome.status, 0, outcome.stderr)
  const data = JSON.parse(outcome.stdout)
  assert.equal(data.mode, 'six-source-historical-retailer-qa-health-only')
  assert.equal(data.assessmentClock, asOf)
  assert.equal(data.sourceKinds, 6)
  assert.equal(data.snapshots, 6)
  assert.equal(data.products, 13)
  assert.equal(data.observations, 16)
  assert.equal(data.historicalOnly, true)
  assert.equal(data.productionEnabled, false)
  assert.equal(data.publicSavingsClaimEligible, false)
  assert.equal(data.trustedCurrentPrices, false)
  assert.deepEqual(Object.keys(data.stores).sort(), ['dekamarkt', 'plus'])
  for (const store of Object.values(data.stores)) {
    assert.equal(store.captureKinds, 3)
    assert.equal(store.snapshots, 3)
    assert.equal(store.staleSnapshots, 3)
    assert.equal(store.futureRelativeToAssessment, 0)
    assert.ok(store.observations > 0)
  }
  assert.equal(Object.values(data.stores).reduce((sum, s) => sum + s.observations, 0), 16)
  assert.doesNotMatch(outcome.stdout, /https?:\/\/|productName|capturedAt|sourceUrl|sourceProductId|priceCents|offerPriceCents|Kippendij/i)
  assert.deepEqual(await readFile(db), before)
  assert.deepEqual(await readdir(dir), ['pilot.db'])
}))

test('identical pinned clock and historical fixtures produce byte-for-byte deterministic QA output', () => withDb(async db => {
  const first = read(db)
  const second = read(db)
  assert.equal(first.status, 0, first.stderr)
  assert.equal(second.status, 0, second.stderr)
  assert.equal(first.stdout, second.stdout)
}))

test('missing one entire retailer blocks health report despite valid metadata for both', () => withDb(async db => {
  const changed = update(db, "DELETE FROM price_observations WHERE retailer_id='dekamarkt'; DELETE FROM products WHERE retailer_id='dekamarkt'; DELETE FROM source_snapshots WHERE retailer_id='dekamarkt';")
  assert.equal(changed.status, 0, changed.stderr)
  refused(read(db))
}))

test('future source capture cannot enter a historical quality report with forged freshness', () => withDb(async db => {
  const changed = update(db, "UPDATE source_snapshots SET captured_at='2035-01-01T00:00:00Z' WHERE retailer_id='plus';")
  assert.equal(changed.status, 0, changed.stderr)
  refused(read(db))
}))

test('fake future assessment clocks and malformed or external input paths fail with no data leakage', () => withDb(async db => {
  refused(read(db, '2035-01-01T00:00:00Z'))
  refused(read(db, '2026-10-15'))
  refused(py([cli, '--input', 'https://www.plus.nl?key=FAKE_SECRET', '--as-of', asOf]))
}))
