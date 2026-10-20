/**
 * Independent SUPA M3 QA, frozen product-owner budgeted catalog composition.
 * Uses six actually committed reviewed PLUS/Deka archive fixtures and
 * exclusively synthetic in-memory variants. No live retailer traffic,
 * source permissions, customer amounts or public/current price claims.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'
import { buildBudgetedPrivateRetailerCatalog } from '../scripts/retailer-private-budgeted-catalog.mjs'

const genuine = () => loadReviewedRepositoryFixtures()

test('budgeted catalog retains exact six-source historical catalog parity without public price trust', async () => {
  const batch = structuredClone(await genuine())
  const original = structuredClone(batch)
  const safe = buildBudgetedPrivateRetailerCatalog(batch)
  const canonical = buildUniversalRetailerCatalog(batch)
  assert.deepEqual(safe, canonical,
    'bounded caller snapshot must not silently lose archived conflict/capture provenance')
  assert.deepEqual(batch, original)
  assert.equal(safe.sourceCount, 6)
  assert.equal(safe.status, 'private-review-only')
  assert.equal(safe.productionEnabled, false)
  assert.equal(safe.publicSavingsClaimEligible, false)
  for (const product of safe.products) {
    assert.equal(product.currentTrustedPriceCents, null)
    assert.equal(product.sourceRightsVerified, false)
    assert.equal(product.publishable, false)
    assert.equal(product.selectedSnapshotSha256, null)
    for (const capture of product.captures) {
      assert.match(capture.snapshotSha256, /^[a-f0-9]{64}$/)
      assert.ok(['product','catalog','offers'].includes(capture.sourceKind))
    }
  }
})

test('same source ID and identical product name across PLUS/Deka never merge retailers in budgeted path', async () => {
  const batch = structuredClone(await genuine())
  const plus = batch.results.find(row => row.key === 'plus:product')
  const deka = batch.results.find(row => row.key === 'dekamarkt:product')
  assert.ok(plus && deka)
  const id = plus.observations[0].sourceProductId
  deka.observations[0].sourceProductId = id
  deka.observations[0].name = plus.observations[0].name
  const safe = buildBudgetedPrivateRetailerCatalog(batch)
  assert.ok(safe.products.some(x => x.canonicalKey === 'plus:' + id))
  assert.ok(safe.products.some(x => x.canonicalKey === 'dekamarkt:' + id))
  assert.deepEqual(safe, buildUniversalRetailerCatalog(batch))
})

test('two different synthetic archived cents for same product remain a private unresolved conflict', async () => {
  const batch = await genuine()
  const first = structuredClone(batch.results.find(x => x.key === 'plus:product'))
  const second = structuredClone(first)
  second.observations[0].currentPriceCents += 77
  second.observations[0].provenance.sha256 = 'b'.repeat(64)
  second.observations[0].provenance.capturedAt = '2026-10-14T11:00:00Z'
  // Do not change a genuine fixture on disk. Supply the minimum existing
  // reviewed-only summary understood by both exported catalog functions.
  const synthetic = { summary: { mode: 'reviewed-offline-only' },
    results: [first, second] }
  const safe = buildBudgetedPrivateRetailerCatalog(synthetic)
  assert.deepEqual(safe, buildUniversalRetailerCatalog(synthetic))
  const affected = safe.products.find(x =>
    x.canonicalKey === 'plus:' + first.observations[0].sourceProductId)
  assert.ok(affected)
  assert.equal(affected.captures.length, 2)
  assert.equal(affected.consistency, 'review-required')
  assert.equal(affected.currentTrustedPriceCents, null)
  assert.equal(affected.publishable, false)
  assert.equal(affected.sourceRightsVerified, false)
})

test('new budgeted entrypoint must not admit old catalog mixed-case source credential marker [EXPECTED RED]', async () => {
  const batch = structuredClone(await genuine())
  const plus = batch.results.find(row => row.key === 'plus:product')
  assert.ok(plus && plus.observations.length > 0)
  const old = plus.observations[0].provenance.url
  const credentialBearing = new URL(old)
  credentialBearing.searchParams.set('ACCESS_TOKEN', 'FICTIONAL_NO_SECRET')
  for (const fact of plus.observations) {
    fact.provenance.url = credentialBearing.href
  }
  assert.throws(() => buildBudgetedPrivateRetailerCatalog(batch),
    /(?:Private offline catalog input refused|Untrusted retailer capture source URL)/,
    'private wrapper must fail closed until catalog owner #3210 case-insensitive query fix integrates')
})
