/**
 * Independent SUPA M3 quality-validation, relational provenance acceptance.
 * Frozen product owner #3235 exact a2ea75ca6046de9257cf66937b9d56655b497fc4.
 * Uses six real previously-reviewed historical PLUS/Deka fixture shapes and
 * newly created private temporary SQLite DBs. No retailer HTTP, new permission,
 * customer/participant evidence, current prices or public savings claim.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildReviewedRetailerSqlite } from
  '../scripts/retailer-build-reviewed-universal-sqlite.mjs'
import { loadReviewedRepositoryFixtures } from
  '../scripts/retailer-reviewed-ingest-engine.mjs'

const PYTHON = [
  'import json, sqlite3, sys',
  'con = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True)',
  'con.execute("PRAGMA foreign_keys=ON")',
  'fetch = lambda q: con.execute(q).fetchall()',
  'snapshots = fetch("SELECT retailer_id, kind, COUNT(*) FROM source_snapshots GROUP BY retailer_id, kind ORDER BY retailer_id, kind")',
  'permissions = fetch("SELECT retailer_id, permission_status, production_enabled FROM retailer_sources ORDER BY retailer_id")',
  'markers = fetch("SELECT key, value FROM metadata ORDER BY key")',
  'orphan_count = fetch("SELECT COUNT(*) FROM price_observations o LEFT JOIN source_snapshots s ON s.id=o.snapshot_id AND s.retailer_id=o.retailer_id LEFT JOIN products p ON p.retailer_id=o.retailer_id AND p.source_product_id=o.source_product_id WHERE s.id IS NULL OR p.retailer_id IS NULL")[0][0]',
  'print(json.dumps({',
  '  "snapshots": snapshots, "permissions": permissions, "markers": markers,',
  '  "quick_check": fetch("PRAGMA quick_check"),',
  '  "foreign_key_check": fetch("PRAGMA foreign_key_check"),',
  '  "products": fetch("SELECT COUNT(*) FROM products")[0][0],',
  '  "observations": fetch("SELECT COUNT(*) FROM price_observations")[0][0],',
  '  "orphan_count": orphan_count,',
  '  "currencies": fetch("SELECT DISTINCT currency FROM price_observations ORDER BY currency"),',
  '  "retailer_rows": fetch("SELECT retailer_id, COUNT(*) FROM price_observations GROUP BY retailer_id ORDER BY retailer_id")',
  '}))',
  'con.close()',
].join('\n')

async function privateDb(action) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-m3-relational-'))
  try { return await action(join(dir, 'historical-review.sqlite')) }
  finally { await rm(dir, { recursive: true, force: true }) }
}
function inspectDb(db) {
  const child = spawnSync('python3', ['-c', PYTHON, db], {
    encoding: 'utf8', timeout: 15000, maxBuffer: 64 * 1024,
  })
  assert.equal(child.status, 0, 'read-only relational acceptance query must succeed')
  assert.equal(child.stderr, '')
  return JSON.parse(child.stdout)
}

test('private six-source SQLite enforces store-specific 3×2 snapshot provenance and denied rights', async () =>
  privateDb(async path => {
    const fixture = await loadReviewedRepositoryFixtures()
    const result = await buildReviewedRetailerSqlite(path)
    const actual = inspectDb(path)
    assert.equal((await stat(path)).mode & 0o777, 0o600)
    assert.equal(result.canonicalPlannerNeeds, 11)
    assert.equal(result.twoStoreReviewRows, 22)
    assert.equal(result.fullBasketFieldComparisonVerified, false)
    assert.equal(result.publicSavingsClaimEligible, false)
    assert.equal(result.externalNetworkUsed, false)
    assert.deepEqual(actual.quick_check, [['ok']])
    assert.deepEqual(actual.foreign_key_check, [])
    assert.equal(actual.orphan_count, 0)
    assert.deepEqual(actual.permissions, [
      ['dekamarkt', 'unresolved', 0],
      ['plus', 'permission_required', 0],
    ])
    assert.deepEqual(actual.snapshots, [
      ['dekamarkt', 'catalog', 1],
      ['dekamarkt', 'offers', 1],
      ['dekamarkt', 'product', 1],
      ['plus', 'catalog', 1],
      ['plus', 'offers', 1],
      ['plus', 'product', 1],
    ])
    assert.equal(actual.products, result.products)
    assert.equal(actual.observations, result.observations)
    assert.equal(actual.observations, fixture.summary.observations)
    assert.deepEqual(actual.currencies, [['EUR']])
    assert.equal(actual.retailer_rows.length, 2)
    assert.equal(actual.retailer_rows[0][0], 'dekamarkt')
    assert.equal(actual.retailer_rows[1][0], 'plus')
    assert.equal(actual.retailer_rows[0][1] + actual.retailer_rows[1][1],
      actual.observations)
  }))

test('persisted SQLite metadata proves historical-only source license and public-savings denial', async () =>
  privateDb(async path => {
    const result = await buildReviewedRetailerSqlite(path)
    const actual = inspectDb(path)
    const metadata = Object.fromEntries(actual.markers)
    assert.equal(metadata.schema_version, '1')
    assert.equal(metadata.origin, 'offline-reviewed-snapshots-only')
    assert.equal(metadata.production_enabled, 'false')
    assert.equal(metadata.public_savings_claim_eligible, 'false')
    assert.equal(metadata.requires_explicit_retailer_license, 'true')
    assert.equal(result.productionEnabled, false)
    assert.equal(result.publicSavingsClaimEligible, false)
    assert.equal(result.historicalOnly, true)
    assert.equal(result.databaseCreated, true)
    assert.doesNotMatch(JSON.stringify(result),
      /https?:\/\/|sourceProductId|currentPriceCents|offerPriceCents|snapshotSha256|participantKey/)
  }))
