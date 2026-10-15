import assert from 'node:assert/strict'
import test from 'node:test'

import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// Direct API admission (not a fake parser): all six reviewed M1 fixtures are
// offline; only a cloned fictional capturedAt value changes in each RED probe.
async function withCapturedAt(timestamp) {
  const batch = structuredClone(await loadReviewedRepositoryFixtures())
  const source = batch.results.find(result => result.key === 'plus:product')
  assert.ok(source?.accepted)
  source.observations[0].provenance.capturedAt = timestamp
  return batch
}

test('positive: original six accepted historical fixtures remain a private, nonpublishable catalog', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const catalog = buildUniversalRetailerCatalog(batch)
  assert.equal(catalog.sourceCount, 6)
  assert.ok(catalog.productCount > 0)
  assert.equal(catalog.productionEnabled, false)
  assert.equal(catalog.publicSavingsClaimEligible, false)
  for (const product of catalog.products) {
    assert.equal(product.publishable, false)
    assert.equal(product.sourceRightsVerified, false)
    assert.equal(product.currentTrustedPriceCents, null)
    assert.equal(product.selectedSnapshotSha256, null)
  }
})

test('positive: plainly malformed provenance date is rejected by direct catalog admission', async () => {
  const batch = await withCapturedAt('not-a-timestamp')
  assert.throws(() => buildUniversalRetailerCatalog(batch),
    /invalid|captur|date|provenance/i)
})

test('expected RED: impossible 30 February must fail closed even if JS Date.parse normalizes it', async () => {
  const impossible = '2026-02-30T10:00:00Z'
  assert.ok(Number.isFinite(Date.parse(impossible)),
    'this reproducible defect only applies when runtime permissively normalizes the date')
  const batch = await withCapturedAt(impossible)
  assert.throws(() => buildUniversalRetailerCatalog(batch),
    /invalid|captur|date|provenance|calendar/i,
    'direct API must not admit impossible civil dates as historical retailer captures')
})

test('expected RED: impossible 31 April with an offset is not reviewed capture evidence', async () => {
  const impossible = '2026-04-31T10:00:00+02:00'
  assert.ok(Number.isFinite(Date.parse(impossible)),
    'runtime normalizes this impossible day; our provenance gate must not')
  const batch = await withCapturedAt(impossible)
  assert.throws(() => buildUniversalRetailerCatalog(batch),
    /invalid|captur|date|provenance|calendar/i,
    'the strict day/month check must precede any apparent successful catalog creation')
})
