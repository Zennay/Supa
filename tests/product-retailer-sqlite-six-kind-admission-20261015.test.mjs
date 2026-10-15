import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildReviewedRetailerSqlite } from '../scripts/retailer-build-reviewed-universal-sqlite.mjs'

// All tests use locally bundled, real historical sanitized snapshots. Each SQL
// mutation touches only a newly created private temp database; no network.
const reader = fileURLToPath(new URL('../scripts/retailer-private-sqlite-planner-reader.py', import.meta.url))
const invoke = (args) => spawnSync('python3', args, {
  encoding: 'utf8', timeout: 25_000, maxBuffer: 4 * 1024 * 1024,
})
const read = db => invoke([reader, '--database', db])
const mutate = (db, sql) => invoke(['-c',
  'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(sys.argv[2]); c.commit(); c.close()',
  db, sql,
])
async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-six-kind-product-'))
  const db = join(dir, 'private.db')
  try {
    const result = await buildReviewedRetailerSqlite(db)
    assert.equal(result.sources, 6)
    assert.equal(result.snapshots, 6)
    assert.equal((await stat(db)).mode & 0o777, 0o600)
    return await fn(db)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
function refused(response) {
  assert.equal(response.status, 2)
  assert.equal(response.stdout, '', 'incomplete source evidence may not emit even partial catalog')
  assert.match(response.stderr, /^Private reviewed SQLite planner reader refused\s*$/)
  assert.doesNotMatch(response.stderr, /\/tmp\/|private\.db|https?:\/\/|source_url/i)
}

test('complete real six-source fixture remains accepted, price-free and unchanged by read-only IPC', () => fixture(async db => {
  const before = await readFile(db)
  const result = read(db)
  assert.equal(result.status, 0, result.stderr)
  const catalog = JSON.parse(result.stdout)
  assert.equal(catalog.productCount, 13)
  assert.deepEqual(new Set(catalog.products.map(p => p.retailerId)), new Set(['plus','dekamarkt']))
  assert.ok(catalog.products.every(p => !p.publishable && !p.sourceRightsVerified && p.currentTrustedPriceCents === null))
  assert.equal(catalog.productionEnabled, false)
  assert.equal(catalog.publicSavingsClaimEligible, false)
  assert.doesNotMatch(result.stdout, /currentPriceCents\":\s*[1-9]|sourceUrl|offerPriceCents|permissionStatus/)
  assert.deepEqual(await readFile(db), before)
}))

test('missing BOTH offers source snapshots cannot masquerade as the complete six-kind pilot', () => fixture(async db => {
  const changed = mutate(db, `
    DELETE FROM price_observations WHERE snapshot_id IN
      (SELECT id FROM source_snapshots WHERE kind='offers');
    DELETE FROM source_snapshots WHERE kind='offers';
  `)
  assert.equal(changed.status, 0, changed.stderr)
  refused(read(db))
}))

test('missing only DekaMarkt catalog source remains an incomplete retailer pilot', () => fixture(async db => {
  const changed = mutate(db, `
    DELETE FROM price_observations WHERE snapshot_id IN
      (SELECT id FROM source_snapshots WHERE retailer_id='dekamarkt' AND kind='catalog');
    DELETE FROM source_snapshots WHERE retailer_id='dekamarkt' AND kind='catalog';
  `)
  assert.equal(changed.status, 0, changed.stderr)
  refused(read(db))
}))

test('declared offers source with no physical offer observation is not evidence of reviewed offers', () => fixture(async db => {
  const changed = mutate(db, `
    DELETE FROM price_observations WHERE snapshot_id IN
      (SELECT id FROM source_snapshots WHERE retailer_id='plus' AND kind='offers');
  `)
  assert.equal(changed.status, 0, changed.stderr)
  refused(read(db))
}))

test('all-store coverage remains mandatory after six-kind enrichment', () => fixture(async db => {
  const changed = mutate(db, `
    DELETE FROM price_observations WHERE retailer_id='dekamarkt';
    DELETE FROM products WHERE retailer_id='dekamarkt';
    DELETE FROM source_snapshots WHERE retailer_id='dekamarkt';
  `)
  assert.equal(changed.status, 0, changed.stderr)
  refused(read(db))
}))
