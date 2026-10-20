import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { comparePrivateRetailerFactChanges } from '../scripts/retailer-private-fact-change-review.mjs'

// Independent quality-validation of NEWLY MERGED historical fact-change module.
// All six inputs are versioned, archived M1 fixtures; derived second captures
// below are FICTIONAL in-memory variants, not retailer HTTP/price observations.
const keys = [
  'plus:product', 'plus:catalog', 'plus:offers',
  'dekamarkt:product', 'dekamarkt:catalog', 'dekamarkt:offers',
]
const reviewAt = '2026-10-15T21:00:00.000Z'
const newerTime = '2026-10-14T12:00:00.000000001Z'
const fictionalName = 'FICTIONAL_PRIVATE_PRODUCT_CHANGE_NOT_LIVE'
const report = (oldBatch, nextBatch) => comparePrivateRetailerFactChanges(
  oldBatch, nextBatch, { referenceTime: reviewAt },
)

function newerFixture(base, key, mutate) {
  const next = structuredClone(base)
  const capture = next.results.find(r => r.key === key && r.accepted)
  assert.ok(capture && capture.observations.length > 0,
    'canonical reviewed shape expected: ' + key)
  for (const obs of capture.observations) {
    obs.provenance.capturedAt = newerTime
    obs.provenance.sha256 = 'c'.repeat(64)
  }
  mutate(capture.observations[0])
  return next
}

function safePrivateReport(result, rawMarker) {
  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes(rawMarker), false,
    'private report must remain aggregated; never contain fictional raw fact')
  assert.equal(serialized.includes('https://www.plus.nl'), false)
  assert.equal(serialized.includes('https://www.dekamarkt.nl'), false)
  assert.equal(result.historicalOnly, true)
  assert.equal(result.sourceRightsVerified, false)
  assert.equal(result.livePricesAvailable, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.externalRequests, 0)
}

test('independent six-source name-change matrix preserves exact shape attribution and zero publication', async () => {
  const original = await loadReviewedRepositoryFixtures()
  const originalBytes = JSON.stringify(original)
  for (const key of keys) {
    const next = newerFixture(original, key, obs => { obs.name = fictionalName })
    const nextBytes = JSON.stringify(next)
    const result = report(original, next)
    assert.equal(result.totals.nameChanged, 1, key)
    assert.equal(result.perShape[key].nameChanged, 1, key)
    assert.equal(result.totals.added, 0, key)
    assert.equal(result.totals.missing, 0, key)
    assert.equal(result.totals.priceChanged, 0, key)
    for (const peer of keys.filter(other => other !== key)) {
      assert.equal(result.perShape[peer].nameChanged, 0,
        key + ' must not affect ' + peer)
    }
    safePrivateReport(result, fictionalName)
    assert.equal(JSON.stringify(next), nextBytes, 'review must not mutate synthetic observations')
    assert.equal(JSON.stringify(original), originalBytes, 'review must not mutate archived baseline')
  }
})

test('independent six-source cents-change matrix never turns archive movement into public prices', async () => {
  const original = await loadReviewedRepositoryFixtures()
  for (const key of keys) {
    let marker
    const next = newerFixture(original, key, obs => {
      marker = (obs.currentPriceCents ?? 9876) + 1
      obs.currentPriceCents = marker
    })
    const decision = report(original, next)
    assert.equal(decision.totals.priceChanged, 1, key)
    assert.equal(decision.perShape[key].priceChanged, 1, key)
    assert.equal(decision.totals.nameChanged, 0, key)
    assert.equal(decision.totals.added, 0, key)
    assert.equal(decision.totals.missing, 0, key)
    for (const peer of keys.filter(other => other !== key)) {
      assert.equal(decision.perShape[peer].priceChanged, 0,
        'a ' + key + ' simulated price cannot alter ' + peer)
    }
    safePrivateReport(decision, '"currentPriceCents":' + marker)
  }
})

test('independent six-shape unchanged baseline is stable across equivalent but distinct cloned objects', async () => {
  const original = await loadReviewedRepositoryFixtures()
  const copy = structuredClone(original)
  const before = JSON.stringify(original)
  const after = JSON.stringify(copy)
  const decision = report(original, copy)
  assert.equal(decision.totals.nameChanged, 0)
  assert.equal(decision.totals.priceChanged, 0)
  assert.equal(decision.totals.unchanged, decision.comparedProducts)
  assert.equal(decision.comparedProducts > 0, true)
  assert.equal(JSON.stringify(original), before)
  assert.equal(JSON.stringify(copy), after)
  safePrivateReport(decision, fictionalName)
})
