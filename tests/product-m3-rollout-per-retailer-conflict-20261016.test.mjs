/**
 * Product regression for #3302: an accepted archival shape is not proof that
 * its own retailer's captured product facts are consistent.
 * Historical, synthetic cloned fixtures only; no store network or live prices.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { planPrivateRetailerRollout } from '../scripts/retailer-private-source-rollout-matrix.mjs'

const referenceTime = '2026-10-05T01:00:00.000Z'
const rights = async () => JSON.parse(await readFile(
  new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))

function withConflictingProduct(batch, retailerId, sha) {
  const source = batch.results.find(result =>
    result.key === retailerId + ':product' && result.accepted === true)
  assert.ok(source, 'archival product fixture must be present')
  const newEvent = structuredClone(source)
  for (const observation of newEvent.observations) {
    observation.provenance.capturedAt = '2026-10-05T00:00:00.000000001Z'
    observation.provenance.sha256 = sha.repeat(64)
  }
  newEvent.observations[0].currentPriceCents =
    (newEvent.observations[0].currentPriceCents ?? 100) + 7
  batch.results.push(newEvent)
  batch.summary.sources++
  batch.summary.acceptedSources++
  batch.summary.observations += newEvent.observations.length
  batch.summary.retailerCounts[retailerId] += newEvent.observations.length
}

function actions(report, retailerId) {
  const retailer = report.retailers.find(row => row.retailerId === retailerId)
  assert.ok(retailer)
  return retailer.nextActions
}

function verifyPrivateFlags(report) {
  assert.equal(report.historicalAcceptedShapes, 6)
  assert.equal(report.permissionVerifiedForNewCapture, false)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.liveRetailerRequests, 0)
  assert.equal(report.scheduledRefreshEnabled, false)
  assert.equal(report.retailers.every(row =>
    row.liveScrapingEnabled === false &&
    row.currentPricePublicationAllowed === false), true)
}

test('six original historical shapes never create a false conflict-review requirement', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const report = planPrivateRetailerRollout(await rights(), batch, { referenceTime })
  verifyPrivateFlags(report)
  assert.equal(actions(report, 'plus').includes('review-conflicting-product-facts'), false)
  assert.equal(actions(report, 'dekamarkt').includes('review-conflicting-product-facts'), false)
})

for (const affected of ['plus', 'dekamarkt']) {
  test('historical product conflict routes review only to ' + affected, async () => {
    const batch = structuredClone(await loadReviewedRepositoryFixtures())
    withConflictingProduct(batch, affected, affected === 'plus' ? 'e' : 'f')
    const unchanged = structuredClone(batch)
    const report = planPrivateRetailerRollout(await rights(), batch, { referenceTime })
    verifyPrivateFlags(report)
    assert.equal(actions(report, affected).includes('review-conflicting-product-facts'), true)
    const other = affected === 'plus' ? 'dekamarkt' : 'plus'
    assert.equal(actions(report, other).includes('review-conflicting-product-facts'), false)
    assert.deepEqual(batch, unchanged, 'review does not alter historical evidence')
    assert.equal(JSON.stringify(report).includes('currentPriceCents'), false)
    assert.equal(JSON.stringify(report).includes('sourceProductId'), false)
  })
}

test('both retailers independently retain their historical conflict-review actions', async () => {
  const batch = structuredClone(await loadReviewedRepositoryFixtures())
  withConflictingProduct(batch, 'plus', 'e')
  withConflictingProduct(batch, 'dekamarkt', 'f')
  const report = planPrivateRetailerRollout(await rights(), batch, { referenceTime })
  verifyPrivateFlags(report)
  for (const retailerId of ['plus', 'dekamarkt']) {
    assert.ok(actions(report, retailerId).includes('review-conflicting-product-facts'))
    assert.ok(actions(report, retailerId)
      .includes('validate-new-captures-offline-before-separate-release-approval'))
  }
})

test('conflicting history cannot bypass source rights or forged publication metadata', async () => {
  const batch = structuredClone(await loadReviewedRepositoryFixtures())
  withConflictingProduct(batch, 'plus', 'e')
  batch.summary.productionEnabled = true
  const gate = await rights()
  assert.throws(
    () => planPrivateRetailerRollout(gate, batch, { referenceTime }),
    /Private retailer adapter health review refused/,
  )
})
