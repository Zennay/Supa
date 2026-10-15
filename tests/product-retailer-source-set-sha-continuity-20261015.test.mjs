import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { comparePrivateRetailerFactChanges } from '../scripts/retailer-private-fact-change-review.mjs'

// Genuine archived, previously reviewed PLUS multicolumn catalog, with only
// hypothetical in-memory timestamps and SHA/identity mutations. No real HTTP.
const at = '2026-10-15T21:00:00.000Z'
const compare = (before, after) =>
  comparePrivateRetailerFactChanges(before, after, { referenceTime: at })
function newCatalog(before, differentSha = false) {
  const after = structuredClone(before)
  const catalog = after.results.find(x => x.key === 'plus:catalog' && x.accepted)
  assert.ok(catalog)
  assert.ok(catalog.observations.length >= 2, 'use a real multi-product catalog shape')
  for (const observation of catalog.observations) {
    observation.provenance.capturedAt = '2026-10-14T12:00:00.000000001Z'
    if (differentSha) observation.provenance.sha256 = 'b'.repeat(64)
  }
  return { after, catalog }
}
function removeOne(after, catalog) {
  catalog.observations.pop()
  after.summary.observations--
  after.summary.retailerCounts.plus--
}

test('product: complete original six-shape archived capture stays unchanged', async () => {
  const base = await loadReviewedRepositoryFixtures()
  const result = compare(base, base)
  assert.equal(result.totals.missing, 0)
  assert.equal(result.totals.added, 0)
  assert.equal(result.totals.unchanged, result.comparedProducts)
  assert.equal(result.publicSavingsClaimEligible, false)
})

test('product: identical raw PLUS catalog HTML at later physical instant retains all product identities', async () => {
  const old = await loadReviewedRepositoryFixtures()
  const { after } = newCatalog(old)
  const result = compare(old, after)
  assert.equal(result.totals.missing, 0)
  assert.equal(result.totals.added, 0)
  assert.equal(result.totals.priceChanged, 0)
  assert.equal(result.totals.unchanged, result.comparedProducts)
})

test('product: same SHA+URL cannot disguise omitted catalog product as store removal', async () => {
  const old = await loadReviewedRepositoryFixtures()
  const { after, catalog } = newCatalog(old)
  removeOne(after, catalog)
  assert.throws(() => compare(old, after), /Private retailer fact change review refused/u)
})

test('product: same SHA+URL cannot disguise renamed catalog sourceProductId as add+missing', async () => {
  const old = await loadReviewedRepositoryFixtures()
  const { after, catalog } = newCatalog(old)
  catalog.observations[0].sourceProductId = 'fictional-changed-id-3070'
  assert.throws(() => compare(old, after), /Private retailer fact change review refused/u)
})

test('product: same raw source SHA cannot invent an additional parsed product', async () => {
  const old = await loadReviewedRepositoryFixtures()
  const { after, catalog } = newCatalog(old)
  const cloned = structuredClone(catalog.observations[0])
  cloned.sourceProductId = 'fictional-new-extra-item-3070'
  catalog.observations.push(cloned)
  after.summary.observations++
  after.summary.retailerCounts.plus++
  assert.throws(() => compare(old, after), /Private retailer fact change review refused/u)
})

test('product: different hypothetical HTML SHA may mark a missing source identity only for private review', async () => {
  const old = await loadReviewedRepositoryFixtures()
  const { after, catalog } = newCatalog(old, true)
  removeOne(after, catalog)
  const result = compare(old, after)
  assert.equal(result.totals.missing, 1)
  assert.equal(result.totals.added, 0)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.sourceRightsVerified, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.externalRequests, 0)
  assert.equal(JSON.stringify(result).includes('www.plus.nl'), false)
})

test('product: same SHA/URL + changed physical time still cannot fabricate price while preserving SKU set', async () => {
  const old = await loadReviewedRepositoryFixtures()
  const { after, catalog } = newCatalog(old)
  catalog.observations[0].currentPriceCents =
    (catalog.observations[0].currentPriceCents ?? 150) + 1
  assert.throws(() => compare(old, after), /Private retailer fact change review refused/u)
})
