import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildBudgetedPrivateRetailerCatalog } from '../scripts/retailer-private-budgeted-catalog.mjs'

// Exactly the existing six archived PLUS/Deka shapes. All changed URLs are
// fictional in-memory observations, never fetched or published.
async function alteredProductUrl(query) {
  const batch = structuredClone(await loadReviewedRepositoryFixtures())
  const result = batch.results.find(row => row.key === 'plus:product')
  assert.ok(result)
  for (const observation of result.observations) {
    const url = new URL(observation.provenance.url)
    url.search = query
    observation.provenance.url = url.href
  }
  return batch
}

test('private budgeted catalog refuses ASCII-mixed and percent-escaped credential keys', async () => {
  for (const query of [
    '?ACCESS_TOKEN=FICTIONAL',
    '?Access_Token=FICTIONAL',
    '?AcCeSs_ToKeN=FICTIONAL',
    '?%41CCESS_%54OKEN=FICTIONAL',
    '?normal=ok&%61CcEsS_tOkEn=FICTIONAL',
  ]) {
    const batch = await alteredProductUrl(query)
    assert.throws(() => buildBudgetedPrivateRetailerCatalog(batch),
      /Private offline catalog input refused/)
  }
})

test('ordinary historical query metadata remains accepted, without public-price claims', async () => {
  const batch = await alteredProductUrl('?archive_version=1&catalog=reviewed')
  const report = buildBudgetedPrivateRetailerCatalog(batch)
  assert.equal(report.sourceCount, 6)
  assert.equal(report.status, 'private-review-only')
  assert.equal(report.productionEnabled, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.ok(report.products.every(item =>
    item.currentTrustedPriceCents === null &&
    item.sourceRightsVerified === false && item.publishable === false))
})
