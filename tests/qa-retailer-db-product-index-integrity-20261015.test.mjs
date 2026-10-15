import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildReviewedRetailerSqlite } from '../scripts/retailer-build-reviewed-universal-sqlite.mjs'

const script = new URL('../scripts/qa-retailer-reviewed-db-exact-parity.mjs', import.meta.url).pathname
const run = database => spawnSync(process.execPath, [
  '--experimental-strip-types', script, '--database', database,
], { encoding: 'utf8', timeout: 30000, maxBuffer: 128 * 1024 })
const change = (database, sql) => spawnSync('python3', [
  '-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]);c.executescript(sys.argv[2]);c.commit();c.close()',
  database, sql,
], { encoding: 'utf8', timeout: 15000 })

async function onPrivateHistoricalDatabase(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-orphan-qa-'))
  const database = join(dir, 'six-fixtures.sqlite')
  try {
    const summary = await buildReviewedRetailerSqlite(database)
    assert.equal(summary.snapshots, 6)
    assert.equal(summary.products, 13)
    assert.equal(summary.observations, 16)
    assert.equal((await stat(database)).mode & 0o777, 0o600)
    await fn(database)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function assertPrivateDenial(result) {
  assert.equal(result.status, 2, result.stderr)
  assert.equal(result.stdout, '', 'failure must not leak sensitive source facts')
  assert.match(result.stderr, /^Private historical retailer source\/SQLite parity refused\s*$/)
  assert.doesNotMatch(result.stderr, /https?:\/\/|Zuivelmeester|supa-orphan-qa-|license_override|price_cents/i)
}

test('original six retailer captures and product search index pass exact fixture parity unchanged', () =>
  onPrivateHistoricalDatabase(async database => {
    const before = await readFile(database)
    const result = run(database)
    assert.equal(result.status, 0, result.stderr)
    const summary = JSON.parse(result.stdout)
    assert.equal(summary.matchesOriginalFixtures, true)
    assert.equal(summary.verifiedObservations, 16)
    assert.equal(summary.publicSavingsClaimEligible, false)
    assert.equal(summary.productionEnabled, false)
    assert.deepEqual(await readFile(database), before, 'quality reader must not write')
  }))

test('unobserved forged product identity cannot hide behind unchanged 16 prices / six captures', () =>
  onPrivateHistoricalDatabase(async database => {
    const altered = change(database, `INSERT INTO products
      (retailer_id,source_product_id,display_name,search_name)
      VALUES ('plus','fictional_injected_sku','Fictional Orphan Product','fictional orphan product');`)
    assert.equal(altered.status, 0, altered.stderr)
    assertPrivateDenial(run(database))
  }))

test('derived search index corruption cannot be laundered through valid priced observation rows', () =>
  onPrivateHistoricalDatabase(async database => {
    const altered = change(database, `UPDATE products
      SET search_name='wrong normalized search token'
      WHERE retailer_id='plus' AND source_product_id=(
        SELECT source_product_id FROM products WHERE retailer_id='plus' ORDER BY source_product_id LIMIT 1
      );`)
    assert.equal(altered.status, 0, altered.stderr)
    assertPrivateDenial(run(database))
  }))

test('private metadata must refuse additional shadow authorization declarations', () =>
  onPrivateHistoricalDatabase(async database => {
    const altered = change(database, `INSERT INTO metadata(key,value)
      VALUES ('license_override','production-enabled');`)
    assert.equal(altered.status, 0, altered.stderr)
    assertPrivateDenial(run(database))
  }))

test('tampered search index must not echo private source paths or product values to stderr', () =>
  onPrivateHistoricalDatabase(async database => {
    const altered = change(database, `UPDATE products SET search_name='private-token-with-secret' WHERE retailer_id='dekamarkt';`)
    assert.equal(altered.status, 0, altered.stderr)
    assertPrivateDenial(run(database))
  }))
