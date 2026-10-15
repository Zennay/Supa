import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildReviewedRetailerSqlite } from '../scripts/retailer-build-reviewed-universal-sqlite.mjs'

// Independent QA on current merged source. These all use the six existing,
// reviewed historical PLUS/Deka source fixtures; no HTTP, no retail permissions.
const reader = new URL('../scripts/retailer-private-sqlite-planner-reader.py', import.meta.url).pathname
const py = (args) => spawnSync('python3', args, {
  encoding: 'utf8', timeout: 25_000, maxBuffer: 4 * 1024 * 1024,
})
const read = (db) => py([reader, '--database', db])
const sql = (db, sqlText) => py(['-c',
  'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(sys.argv[2]); c.commit(); c.close()',
  db, sqlText,
])
async function withDatabase(check) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-sqlite-origin-'))
  const db = join(dir, 'historical.db')
  try {
    const counts = await buildReviewedRetailerSqlite(db)
    assert.equal(counts.sources, 6)
    assert.equal(counts.snapshots, 6)
    assert.equal(counts.products, 13)
    assert.equal((await stat(db)).mode & 0o777, 0o600)
    await check({ dir, db })
  } finally { await rm(dir, { recursive: true, force: true }) }
}
function expectRefusal(outcome) {
  assert.equal(outcome.status, 2, outcome.stderr)
  assert.equal(outcome.stdout, '', 'refuse before any partial catalog reaches the caller')
  assert.match(outcome.stderr, /^Private reviewed SQLite planner reader refused\s*$/)
  assert.doesNotMatch(outcome.stderr, /\/tmp\/|https?:\/\/|source_product_id|FAKE_SECRET/i)
}

test('actual canonical readonly private SQLite round-trip never changes bytes or creates WAL/sidecars', () => withDatabase(async ({ dir, db }) => {
  const before = await readFile(db)
  const result = read(db)
  assert.equal(result.status, 0, result.stderr)
  const catalog = JSON.parse(result.stdout)
  assert.equal(catalog.productCount, 13)
  assert.equal(catalog.productionEnabled, false)
  assert.equal(catalog.publicSavingsClaimEligible, false)
  assert.deepEqual([...new Set(catalog.products.map(p => p.retailerId))].sort(), ['dekamarkt', 'plus'])
  assert.ok(catalog.products.every(p => p.publishable === false && p.sourceRightsVerified === false &&
    p.currentTrustedPriceCents === null && p.selectedSnapshotSha256 === null))
  assert.doesNotMatch(result.stdout, /currentPriceCents\s*:\s*\d|sourceUrl|offerPriceCents|price_cents|https?:\/\//)
  assert.deepEqual(await readFile(db), before, 'read-only preview cannot alter private evidence bytes')
  assert.deepEqual((await readdir(dir)).sort(), ['historical.db'])
}))

test('read-only projection refuses publication-enabled metadata even if original prices are unchanged', () => withDatabase(async ({ db }) => {
  const update = sql(db, "UPDATE metadata SET value='true' WHERE key='public_savings_claim_eligible';")
  assert.equal(update.status, 0, update.stderr)
  expectRefusal(read(db))
}))

test('read-only projection refuses altered canonical origin even when source/SHA records are intact', () => withDatabase(async ({ db }) => {
  const update = sql(db, "UPDATE metadata SET value='fictional-outside-source' WHERE key='origin';")
  assert.equal(update.status, 0, update.stderr)
  expectRefusal(read(db))
}))

test('read-only projection refuses malformed SHA evidence inside an otherwise valid six-source database', () => withDatabase(async ({ db }) => {
  const update = sql(db, "UPDATE source_snapshots SET content_sha256=printf('%064d',1) || 'bad' WHERE id=1;")
  // CHECK(length=64) must prevent any write that would escape the schema.
  assert.notEqual(update.status, 0)
  const mutation = sql(db, "UPDATE source_snapshots SET content_sha256=replace(content_sha256,'a','Z') WHERE id=1;")
  assert.equal(mutation.status, 0, mutation.stderr)
  // Some bundled SHA may not include 'a'; force a 64-character non-hex string.
  const force = sql(db, "UPDATE source_snapshots SET content_sha256='Z' || substr(content_sha256,2) WHERE id=1;")
  assert.equal(force.status, 0, force.stderr)
  expectRefusal(read(db))
}))

test('read-only projection refuses a synthetic credential-bearing source URL without exposing credentials', () => withDatabase(async ({ db }) => {
  const update = sql(db, "UPDATE source_snapshots SET source_url='https://fake:FAKE_SECRET@www.plus.nl/producten' WHERE retailer_id='plus';")
  assert.equal(update.status, 0, update.stderr)
  expectRefusal(read(db))
}))

test('read-only projection rejects forged future timestamps despite valid source rights flags', () => withDatabase(async ({ db }) => {
  const update = sql(db, "UPDATE source_snapshots SET captured_at='2035-01-01T00:00:00.000Z' WHERE retailer_id='dekamarkt';")
  assert.equal(update.status, 0, update.stderr)
  expectRefusal(read(db))
}))
