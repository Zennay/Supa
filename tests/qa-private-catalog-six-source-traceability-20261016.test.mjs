import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import {
  ingestCivilClockCheckedReviewedBatch,
  buildCivilClockCheckedPrivateCatalog,
} from '../scripts/retailer-private-civil-clock-preflight.mjs'
import {
  RETAILER_REVIEWED_FIXTURES,
  readBoundedRegularReviewedFixture,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Independent QA acceptance of the opt-in six-shape private catalog output.
// Genuine, sanitized, repository-pinned PLUS/Deka M1 archives only; no HTTP.
// This is not a license, current price, or real-world savings verification.
async function originals() {
  const root = new URL('../fixtures/m1/', import.meta.url)
  return Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, root)))))
}

function captureKey(retailer, productId, capture) {
  return JSON.stringify([
    retailer, productId, capture.sourceKind, capture.snapshotSha256,
    capture.sourceUrl, capture.capturedAt, capture.name,
    capture.currentPriceCents, capture.currency, capture.pack,
    capture.offer, capture.availability,
  ])
}

function observationKey(observation) {
  return JSON.stringify([
    observation.supermarket, observation.sourceProductId,
    observation.provenance.kind, observation.provenance.sha256,
    observation.provenance.url, observation.provenance.capturedAt,
    observation.name, observation.currentPriceCents, observation.currency,
    observation.pack, observation.offer, observation.availability,
  ])
}

function auditPrivateCatalog(catalog, batch) {
  assert.equal(catalog.schemaVersion, 1)
  assert.equal(catalog.status, 'private-review-only')
  assert.equal(catalog.model, 'universal-retailer-product-captures')
  assert.equal(catalog.productionEnabled, false)
  assert.equal(catalog.publicSavingsClaimEligible, false)
  assert.equal(catalog.sourceCount, batch.summary.acceptedSources)
  assert.equal(catalog.sourceCount, 6)
  assert.equal(catalog.productCount, catalog.products.length)
  assert.equal(catalog.captureCount,
    catalog.products.reduce((sum, item) => sum + item.captures.length, 0))
  assert.equal(catalog.conflictCount,
    catalog.products.filter(item => item.consistency === 'review-required').length)

  const observations = batch.results.flatMap(result => result.observations)
  const actualSet = new Set(observations.map(observationKey))
  assert.equal(observations.length, batch.summary.observations)
  const seenSourceShas = new Set()
  const keys = []
  for (const product of catalog.products) {
    assert.ok(['plus', 'dekamarkt'].includes(product.retailerId))
    assert.equal(product.canonicalKey,
      product.retailerId + ':' + product.retailerProductId)
    keys.push(product.canonicalKey)
    assert.equal(product.publishable, false)
    assert.equal(product.sourceRightsVerified, false)
    assert.equal(product.currentTrustedPriceCents, null)
    assert.equal(product.selectedSnapshotSha256, null)
    assert.ok(product.captures.length > 0)
    assert.ok(['consistent', 'review-required'].includes(product.consistency))
    for (const capture of product.captures) {
      assert.ok(actualSet.has(captureKey(
        product.retailerId, product.retailerProductId, capture)),
      'private catalog capture must trace to one actual accepted adapter observation')
      seenSourceShas.add(capture.snapshotSha256)
    }
  }
  assert.deepEqual(keys, [...keys].sort((a, b) => a.localeCompare(b)))
  const expectedShas = new Set(observations.map(o => o.provenance.sha256))
  assert.deepEqual([...seenSourceShas].sort(), [...expectedShas].sort(),
    'all six adapter source shapes remain traceable via original capture SHA')
}

test('all six historical source shapes yield a fully traceable unpublished catalog', async () => {
  const records = await originals()
  const before = structuredClone(records)
  const batch = ingestCivilClockCheckedReviewedBatch(records)
  const catalog = buildCivilClockCheckedPrivateCatalog(records)
  auditPrivateCatalog(catalog, batch)
  assert.deepEqual(records, before, 'reviewing evidence may not mutate caller archives')
})

test('original input order cannot change which sources, captures or private product facts appear', async () => {
  const records = await originals()
  const forward = buildCivilClockCheckedPrivateCatalog(records)
  const backward = buildCivilClockCheckedPrivateCatalog([...records].reverse())
  assert.deepEqual(backward, forward,
    'operator ordering must not change canonical private M3 catalog evidence')
})

test('all six adapters independently refuse an altered unreviewed retailer origin atomically', async t => {
  const records = await originals()
  const valid = buildCivilClockCheckedPrivateCatalog(records)
  assert.equal(valid.sourceCount, 6)
  for (let index = 0; index < records.length; index++) {
    const { source } = records[index]
    await t.test(source.supermarket + ':' + source.kind, () => {
      const altered = structuredClone(records)
      altered[index].source.url = 'https://unreviewed.example.invalid/private-capture'
      assert.throws(() => buildCivilClockCheckedPrivateCatalog(altered),
        /(?:civil-clock preflight refused|Untrusted|refused)/,
        'one rejected source must refuse the complete six-source catalog')
    })
  }
  assert.equal(buildCivilClockCheckedPrivateCatalog(records).sourceCount, 6)
})
