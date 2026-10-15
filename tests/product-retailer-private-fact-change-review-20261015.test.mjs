import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { comparePrivateRetailerFactChanges, main } from
  '../scripts/retailer-private-fact-change-review.mjs'

// Existing six canonical archival fixtures only, no retailer fetch or grants.
const referenceTime = '2026-10-15T21:00:00.000Z'
const review = (prior, next) =>
  comparePrivateRetailerFactChanges(prior, next, { referenceTime })
function mutateProductSource(batch, transform) {
  const next = structuredClone(batch)
  const candidate = next.results.find(x => x.key === 'plus:product' && x.accepted)
  assert.ok(candidate)
  const stamp = '2026-10-14T12:00:00.000000001Z'
  for (const obs of candidate.observations) {
    obs.provenance.capturedAt = stamp
    obs.provenance.sha256 = 'b'.repeat(64)
  }
  transform(candidate.observations[0])
  return next
}

test('product: exact six archived sources compared with themselves have no drift', async () => {
  const data = await loadReviewedRepositoryFixtures()
  const result = review(data, data)
  assert.equal(result.mode, 'private-historical-retailer-fact-change-review')
  assert.equal(result.totals.priceChanged, 0)
  assert.equal(result.totals.packChanged, 0)
  assert.equal(result.totals.added, 0)
  assert.equal(result.totals.missing, 0)
  assert.equal(result.totals.unchanged, result.comparedProducts)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.publicSavingsClaimEligible, false)
})

test('product: newer in-memory PLUS price, pack, stock and name differences count without exposing values', async () => {
  const data = await loadReviewedRepositoryFixtures()
  const marker = 'synthetic-secret-stock-sku-12987'
  const next = mutateProductSource(data, obs => {
    obs.name = marker
    obs.currentPriceCents = (obs.currentPriceCents ?? 150) + 5
    obs.pack = { ...obs.pack, rawText: 'Fictional 2l pack' }
    obs.availability = obs.availability === 'available' ? 'unavailable' : 'available'
  })
  const result = review(data, next)
  assert.equal(result.totals.priceChanged, 1)
  assert.equal(result.totals.packChanged, 1)
  assert.equal(result.totals.availabilityChanged, 1)
  assert.equal(result.totals.nameChanged, 1)
  assert.equal(result.perShape['dekamarkt:product'].priceChanged, 0)
  assert.equal(result.perShape['plus:product'].priceChanged, 1)
  assert.equal(JSON.stringify(result).includes(marker), false)
  assert.equal(JSON.stringify(result).includes('Fictional 2l pack'), false)
  assert.equal(result.livePricesAvailable, false)
  assert.equal(result.sourceRightsVerified, false)
})

test('product: stale same-product capture cannot be used as chronological progress', async () => {
  const data = await loadReviewedRepositoryFixtures()
  const newest = mutateProductSource(data, x => { x.currentPriceCents = 301 })
  assert.throws(() => review(newest, data), /Private retailer fact change review refused/)
})

test('product: same physical instant cannot contradict its immutable price facts', async () => {
  const data = await loadReviewedRepositoryFixtures()
  const next = structuredClone(data)
  const candidate = next.results.find(x => x.key === 'plus:product' && x.accepted)
  candidate.observations[0].currentPriceCents =
    (candidate.observations[0].currentPriceCents ?? 100) + 2
  assert.throws(() => review(data, next), /Private retailer fact change review refused/)
})

test('product: actual source summary cannot be forged into production eligibility', async () => {
  const data = await loadReviewedRepositoryFixtures()
  const forged = structuredClone(data)
  forged.summary.productionEnabled = true
  assert.throws(() => review(data, forged), /Private retailer adapter health review refused/)
})

test('product: executable CLI emits aggregate archival-only results and rejects input arguments', async () => {
  let output = ''
  const result = await main([], text => { output += text })
  assert.equal(result.totals.priceChanged, 0)
  assert.equal(JSON.parse(output).mode, 'private-historical-retailer-fact-change-review')
  assert.equal(output.includes('www.plus.nl'), false)
  assert.equal(output.includes('halfvolle'), false)
  await assert.rejects(main(['--source', 'https://www.plus.nl/']), /Private retailer fact change review refused/)
})
