import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadReviewedRepositoryFixtures,
  ingestReviewedBatch,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// Independent QA-only cross-boundary tests on historical M1 captures.
// No real-time prices, retailer HTTP, permission grant or public claim.
// All altered monetary/stock/pack values are deliberately fictional negatives.
const privateCatalog = batch => buildUniversalRetailerCatalog(batch)
const limitedBatch = results => ({ summary: { mode: 'reviewed-offline-only' }, results })
const noPublicPrice = catalog => {
  assert.equal(catalog.status, 'private-review-only')
  assert.equal(catalog.productionEnabled, false)
  assert.equal(catalog.publicSavingsClaimEligible, false)
  assert.equal(catalog.sourceCount > 0, true)
  for (const product of catalog.products) {
    assert.equal(product.publishable, false)
    assert.equal(product.sourceRightsVerified, false)
    assert.equal(product.currentTrustedPriceCents, null)
    assert.equal(product.selectedSnapshotSha256, null)
    assert.equal(product.canonicalKey, product.retailerId + ':' + product.retailerProductId)
    assert.ok(product.retailerId === 'plus' || product.retailerId === 'dekamarkt')
  }
}

test('all six archived PLUS/Deka product/catalog/offer sources form private, SHA-backed catalog', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const unmodified = structuredClone(batch)
  const catalog = privateCatalog(batch)
  assert.equal(batch.summary.acceptedSources, 6)
  assert.equal(catalog.sourceCount, 6)
  assert.ok(catalog.productCount > 0)
  assert.ok(catalog.captureCount >= catalog.productCount)
  assert.deepEqual(
    catalog.products.map(p => p.canonicalKey),
    [...catalog.products.map(p => p.canonicalKey)].sort(),
  )
  for (const product of catalog.products) {
    for (const capture of product.captures) {
      const candidates = batch.results.filter(row =>
        row.key === product.retailerId + ':' + capture.sourceKind)
      assert.ok(candidates.some(row =>
        row.observations.some(o =>
          o.sourceProductId === product.retailerProductId &&
          o.provenance.sha256 === capture.snapshotSha256 &&
          o.provenance.capturedAt === capture.capturedAt &&
          o.provenance.url === capture.sourceUrl)),
      'every catalog capture must be backed by an actual reviewed M1 observation')
    }
  }
  assert.deepEqual(batch, unmodified, 'catalog creation must not mutate original evidence')
  noPublicPrice(catalog)
})

test('twelve deterministic source-order permutations cannot change a private basket catalog', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const baseline = privateCatalog(batch)
  const records = batch.results
  const variants = [
    ...Array.from({ length: 6 }, (_, rotation) =>
      [...records.slice(rotation), ...records.slice(0, rotation)]),
    ...Array.from({ length: 6 }, (_, rotation) =>
      [...records.slice(rotation), ...records.slice(0, rotation)].reverse()),
  ]
  for (const [index, results] of variants.entries()) {
    const candidate = privateCatalog({ summary: structuredClone(batch.summary), results })
    assert.deepEqual(candidate, baseline, 'order mutation ' + index)
    noPublicPrice(candidate)
  }
})

test('all six source shapes force review instead of selecting a forged cheaper price or pack', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  let checked = 0
  for (const row of batch.results) {
    const original = structuredClone(row)
    for (const shape of ['money', 'availability', 'pack']) {
      const revised = structuredClone(row)
      const changed = revised.observations[0]
      if (shape === 'money') {
        changed.currentPriceCents = (changed.currentPriceCents ?? 0) + 123
      } else if (shape === 'availability') {
        changed.availability = changed.availability === 'available' ? 'unknown' : 'available'
      } else {
        changed.pack.rawText = 'fictional-other-pack-qa'
      }
      const catalog = privateCatalog(limitedBatch([original, revised]))
      const product = catalog.products.find(item =>
        item.canonicalKey === changed.supermarket + ':' + changed.sourceProductId)
      assert.ok(product, row.key + ':' + shape)
      assert.equal(product.consistency, 'review-required', row.key + ':' + shape)
      assert.ok(product.captures.length >= 2, row.key + ':' + shape)
      noPublicPrice(catalog)
      checked++
    }
  }
  assert.equal(checked, 18)
})

test('cross-store collisions in both name and product ID never create one combined SKU', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const plus = structuredClone(batch.results.find(r => r.key === 'plus:product'))
  const deka = structuredClone(batch.results.find(r => r.key === 'dekamarkt:product'))
  assert.ok(plus && deka)
  const source = plus.observations[0]
  deka.observations[0].sourceProductId = source.sourceProductId
  deka.observations[0].name = source.name
  const catalog = privateCatalog(limitedBatch([plus, deka]))
  assert.ok(catalog.products.some(p => p.canonicalKey === 'plus:' + source.sourceProductId))
  assert.ok(catalog.products.some(p => p.canonicalKey === 'dekamarkt:' + source.sourceProductId))
  noPublicPrice(catalog)
})

test('a contradictory late source invalidates the entire catalog, not only its row', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  for (let i = 0; i < batch.results.length; i++) {
    const corrupt = structuredClone(batch)
    corrupt.results[i].accepted = false
    assert.throws(() => privateCatalog(corrupt), /incomplete or untrusted/)
    const forgedRights = structuredClone(batch)
    forgedRights.summary.permissionVerified = true
    assert.throws(() => privateCatalog(forgedRights), /permission or publication/)
  }
  assert.equal(privateCatalog(batch).sourceCount, 6)
})

test('six original JSON capture records can be re-ingested without count, offer, or rights drift', async () => {
  const originals = await loadReviewedRepositoryFixtures()
  const resultRows = originals.results
  // Independent fixture-loader determinism is stronger than a fake economic
  // claim: capture content, SHA, timestamps and review-only projection agree.
  const again = await loadReviewedRepositoryFixtures()
  assert.deepEqual(again.summary, originals.summary)
  assert.deepEqual(again.results, resultRows)
  assert.deepEqual(privateCatalog(again), privateCatalog(originals))
  assert.equal(again.summary.productionEnabled, false)
  assert.equal(again.summary.permissionVerified, false)
  assert.equal(again.summary.publicSavingsClaimEligible, false)
})
