import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { buildReviewedRetailerSqlite } from '../scripts/retailer-build-reviewed-universal-sqlite.mjs'

// The six-kind preflight is a STRUCTURAL private admission check, not a
// source-licensing or live-retail price validator.
const cli = new URL('../scripts/qa-retailer-sqlite-six-kind-preflight.py', import.meta.url).pathname
const run = database => spawnSync('python3', [cli, '--database', database], {
  encoding: 'utf8', timeout: 25000, maxBuffer: 128 * 1024,
})
const mutate = (database, sql) => spawnSync('python3', [
  '-c', 'import sqlite3,sys;db=sqlite3.connect(sys.argv[1]);db.executescript(sys.argv[2]);db.commit();db.close()',
  database, sql,
], { encoding: 'utf8', timeout: 15000 })

async function privatePilot(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-six-kind-coverage-'))
  const db = join(dir, 'pilot.sqlite')
  try {
    const built = await buildReviewedRetailerSqlite(db)
    assert.equal(built.observations, 16)
    assert.equal(built.products, 13)
    assert.equal(built.snapshots, 6)
    assert.equal((await stat(db)).mode & 0o777, 0o600)
    await fn(db)
  } finally { await rm(dir, { recursive: true, force: true }) }
}
function rejects(result) {
  assert.equal(result.status, 2, result.stderr)
  assert.equal(result.stdout, '', 'failure must never emit partial source counts')
  assert.match(result.stderr, /^Private retailer six-kind QA preflight refused\s*$/)
  assert.doesNotMatch(result.stderr, /https?:\/\/|Zuivelmeester|permission_proof|supa-six-kind-coverage-/)
}
const appendUnobservedSource = `INSERT INTO source_snapshots
  (retailer_id,kind,source_url,captured_at,content_sha256)
  SELECT retailer_id,kind,source_url,captured_at,lower(hex(zeroblob(32)))
    FROM source_snapshots WHERE retailer_id='plus' AND kind='offers' LIMIT 1;`

test('real six-source private pilot passes and read-only QA preserves exact database bytes', () =>
  privatePilot(async db => {
    const before = await readFile(db)
    const result = run(db)
    assert.equal(result.status, 0, result.stderr)
    const proof = JSON.parse(result.stdout)
    assert.equal(proof.accepted, true)
    assert.equal(proof.snapshots, 6)
    assert.equal(proof.products, 13)
    assert.equal(proof.observations, 16)
    assert.equal(proof.productionEnabled, false)
    assert.equal(proof.publicSavingsClaimEligible, false)
    assert.deepEqual(await readFile(db), before)
  }))

test('extra snapshot with zero observations must not masquerade as captured evidence', () =>
  privatePilot(async db => {
    const changed = mutate(db, appendUnobservedSource)
    assert.equal(changed.status, 0, changed.stderr)
    rejects(run(db))
  }))

test('an extra retail SKU lacking physical observations must not pass a six-kind preflight', () =>
  privatePilot(async db => {
    const changed = mutate(db, `INSERT INTO products
      (retailer_id,source_product_id,display_name,search_name)
      VALUES ('dekamarkt','ghost_sku','Synthetic orphan','synthetic orphan');`)
    assert.equal(changed.status, 0, changed.stderr)
    rejects(run(db))
  }))

test('shadow permission metadata is not part of the exact private schema-v1 evidence envelope', () =>
  privatePilot(async db => {
    const changed = mutate(db, `INSERT INTO metadata(key,value)
      VALUES ('permission_proof','fictional-authorization');`)
    assert.equal(changed.status, 0, changed.stderr)
    rejects(run(db))
  }))

test('structurally complete additional historical snapshot remains valid when it has an actual linked observation', () =>
  privatePilot(async db => {
    const changed = mutate(db, appendUnobservedSource + `
      INSERT INTO price_observations (
        snapshot_id,retailer_id,source_product_id,price_cents,currency,pack_text,
        pack_amount,pack_unit,availability,offer_label,offer_price_cents,
        original_price_cents,offer_valid_from,offer_valid_to
      )
      SELECT (SELECT max(id) FROM source_snapshots),o.retailer_id,
        o.source_product_id,o.price_cents,o.currency,o.pack_text,o.pack_amount,
        o.pack_unit,o.availability,o.offer_label,o.offer_price_cents,
        o.original_price_cents,o.offer_valid_from,o.offer_valid_to
      FROM price_observations o JOIN source_snapshots s ON s.id=o.snapshot_id
      WHERE s.retailer_id='plus' AND s.kind='offers' LIMIT 1;`)
    assert.equal(changed.status, 0, changed.stderr)
    const result = run(db)
    assert.equal(result.status, 0, result.stderr)
    const proof = JSON.parse(result.stdout)
    assert.equal(proof.snapshots, 7)
    assert.equal(proof.observations, 17)
    assert.equal(proof.productionEnabled, false)
    assert.equal(proof.publicSavingsClaimEligible, false)
  }))
