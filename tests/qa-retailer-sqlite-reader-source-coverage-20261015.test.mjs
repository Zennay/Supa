import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { buildReviewedRetailerSqlite } from '../scripts/retailer-build-reviewed-universal-sqlite.mjs'

// Independent immutable QA of the newly merged PRIVATE Python reader #2918.
// A valid private DB is first produced using SIX real bundled offline adapters.
// Synthetic tampering happens only to disposable 0600 local files; no HTTP.
const reader = new URL('../scripts/retailer-private-sqlite-planner-reader.py', import.meta.url).pathname
const python = (args) => spawnSync('python3', args, {
  encoding: 'utf8', timeout: 20_000, maxBuffer: 4 * 1024 * 1024,
})
async function temporary(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-sql-source-set-'))
  try { return await fn(join(dir, 'private.db')) }
  finally { await rm(dir, { force: true, recursive: true }) }
}
const read = path => python([reader, '--database', path])
function mutate(path, sql) {
  const result = python(['-c',
    'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("PRAGMA foreign_keys=ON"); c.executescript(sys.argv[2]); c.commit(); c.close()',
    path, sql,
  ])
  assert.equal(result.status, 0, result.stderr)
}

test('positive: original six-source DB has retailer-linked products for both PLUS and DekaMarkt, no price claims', () => temporary(async db => {
  const built = await buildReviewedRetailerSqlite(db)
  assert.equal(built.snapshots, 6)
  assert.equal((await stat(db)).mode & 0o777, 0o600)
  const r = read(db)
  assert.equal(r.status, 0, r.stderr)
  const result = JSON.parse(r.stdout)
  assert.deepEqual([...new Set(result.products.map(p => p.retailerId))].sort(), ['dekamarkt', 'plus'])
  assert.equal(result.productCount, 13)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.ok(result.products.every(p => p.publishable === false && p.currentTrustedPriceCents === null))
  assert.doesNotMatch(r.stdout, /price_cents|currentPriceCents|sourceUrl|offerPriceCents/)
}))

test('private SQLite reader must not accept a source set with every DekaMarkt capture surgically removed', () => temporary(async db => {
  await buildReviewedRetailerSqlite(db)
  mutate(db, `
    DELETE FROM price_observations WHERE retailer_id = 'dekamarkt';
    DELETE FROM products WHERE retailer_id = 'dekamarkt';
    DELETE FROM source_snapshots WHERE retailer_id = 'dekamarkt';
  `)
  const r = read(db)
  assert.notEqual(r.status, 0,
    'two declared retailer sources are not proof that both retailers contributed observations')
  assert.equal(r.stdout, '', 'no partial one-store catalog may be printed as a two-source handoff')
  assert.match(r.stderr, /Private reviewed SQLite planner reader refused/)
  assert.doesNotMatch(r.stderr, /private\.db|\/tmp\//)
}))

test('private SQLite reader still refuses a forged permission grant in an otherwise complete source DB', () => temporary(async db => {
  await buildReviewedRetailerSqlite(db)
  mutate(db, `
    UPDATE retailer_sources SET permission_status = 'permitted' WHERE retailer_id = 'plus';
  `)
  const r = read(db)
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /Private reviewed SQLite planner reader refused/)
}))
