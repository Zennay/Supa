import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, stat, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { buildReviewedRetailerSqlite } from '../scripts/retailer-build-reviewed-universal-sqlite.mjs'

function query(file, sql) {
  const script = 'import sqlite3,sys,json;db=sqlite3.connect(sys.argv[1]);print(json.dumps(db.execute(sys.argv[2]).fetchall()))'
  const response = spawnSync('python3', ['-c', script, file, sql], {
    encoding: 'utf8', timeout: 10000,
  })
  assert.equal(response.status, 0, response.stderr)
  return JSON.parse(response.stdout)
}

test('REAL six reviewed PLUS/Deka adapters -> one universal DB, original snapshot lines retained, no public price promotion', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'supa-adapter-db-'))
  const output = join(tmp, 'universal.db')
  const oldFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('NO RETAIL NETWORK IN HISTORICAL DB IMPORT') }
  try {
    const summary = await buildReviewedRetailerSqlite(output)
    assert.equal(summary.databaseCreated, true)
    assert.equal(summary.externalNetworkUsed, false)
    assert.equal(summary.historicalOnly, true)
    assert.equal(summary.productionEnabled, false)
    assert.equal(summary.publicSavingsClaimEligible, false)
    assert.equal(summary.sources, 6)
    assert.equal(summary.snapshots, 6)
    assert.equal(summary.observations, 16)
    assert.equal(summary.products, 13)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
    assert.deepEqual(query(output, 'SELECT retailer_id,COUNT(*) FROM products GROUP BY retailer_id ORDER BY retailer_id'), [
      ['dekamarkt', 6], ['plus', 7],
    ])
    assert.deepEqual(query(output, 'SELECT kind, COUNT(*) FROM source_snapshots GROUP BY kind ORDER BY kind'), [
      ['catalog', 2], ['offers', 2], ['product', 2],
    ])
    assert.deepEqual(query(output, "SELECT retailer_id,source_product_id,price_cents FROM price_observations WHERE source_product_id IN ('115873','579010') ORDER BY retailer_id,price_cents"), [
      ['dekamarkt', '115873', 85], ['dekamarkt', '115873', 85],
      // PLUS's historical product JSON-LD has only a unit price, not a
      // payable pack Offer.price; SQL must retain that unknown as NULL.
      ['plus', '579010', null], ['plus', '579010', 85],
    ])
    assert.deepEqual(query(output, "SELECT COUNT(*) FROM price_observations WHERE retailer_id='plus' AND source_product_id='579010' AND price_cents IS NULL"), [[1]])
    assert.deepEqual(query(output, "SELECT value FROM metadata WHERE key='production_enabled'"), [['false']])
    const text = await readFile(output)
    assert.ok(text.byteLength > 10000)
    await assert.rejects(buildReviewedRetailerSqlite(output), /refused/)
    assert.deepEqual(query(output, "SELECT COUNT(*) FROM price_observations"), [[16]])
  } finally {
    globalThis.fetch = oldFetch
    await rm(tmp, { recursive: true, force: true })
  }
})

test('unified CLI prints aggregate counts but never historical product names, prices or source URLs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-adapter-db-cli-'))
  try {
    const file = join(dir, 'reviewed.db')
    const response = spawnSync(process.execPath, [
      '--experimental-strip-types',
      new URL('../scripts/retailer-build-reviewed-universal-sqlite.mjs', import.meta.url).pathname,
      '--out', file,
    ], { encoding: 'utf8', timeout: 45000, maxBuffer: 128*1024 })
    assert.equal(response.status, 0, response.stderr)
    const json = JSON.parse(response.stdout)
    assert.equal(json.databaseCreated, true)
    assert.equal(json.historicalOnly, true)
    for (const forbidden of ['plus.nl', 'dekamarkt.nl', 'Zuivelmeester', 'Del Monte', '0.85']) {
      assert.ok(!response.stdout.includes(forbidden))
    }
    assert.equal((await stat(file)).mode & 0o777, 0o600)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
