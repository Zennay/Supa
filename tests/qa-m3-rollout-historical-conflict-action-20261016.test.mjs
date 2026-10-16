/**
 * Immutable independent quality-validation for conflicting historic PLUS/Deka
 * product facts in the human operator rollout. Only synthetic cloned in-memory
 * facts: no source network calls, no retailer price assertions and no rights.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'
import { planPrivateRetailerRollout } from '../scripts/retailer-private-source-rollout-matrix.mjs'

const clock = '2026-10-05T01:00:00.000Z'
const rights = async () => JSON.parse(await readFile(
  new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))

function syntheticContradictorySnapshot(original) {
  const batch = structuredClone(original)
  const source = batch.results.find(result => result.key === 'plus:product' && result.accepted)
  assert.ok(source)
  const next = structuredClone(source)
  for (const observation of next.observations) {
    observation.provenance.capturedAt = '2026-10-05T00:00:00.000000001Z'
    observation.provenance.sha256 = 'f'.repeat(64)
  }
  next.observations[0].currentPriceCents =
    (next.observations[0].currentPriceCents ?? 100) + 7
  batch.results.push(next)
  batch.summary.sources += 1
  batch.summary.acceptedSources += 1
  batch.summary.observations += next.observations.length
  batch.summary.retailerCounts.plus += next.observations.length
  return batch
}

test('QA positive: authentic six-shape archive remains private and does not invent a store price', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const report = planPrivateRetailerRollout(await rights(), batch, { referenceTime: clock })
  assert.equal(report.expectedShapeCount, 6)
  assert.equal(report.historicalAcceptedShapes, 6)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.permissionVerifiedForNewCapture, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.liveRetailerRequests, 0)
})

test('QA EXPECTED RED: the rollout operator must see canonical conflicting product facts as an explicit action', async () => {
  const original = await loadReviewedRepositoryFixtures()
  const batch = syntheticContradictorySnapshot(original)
  const before = structuredClone(batch)
  const catalog = buildUniversalRetailerCatalog(batch)
  const health = evaluatePrivateAdapterHealth(batch, { referenceTime: clock })
  assert.ok(catalog.conflictCount > 0,
    'independent catalog proves synthetic contradictory observations exist')
  assert.equal(health.inconsistentProducts, catalog.conflictCount)
  assert.ok(health.operatorActions.includes('review-conflicting-product-facts'))
  const report = planPrivateRetailerRollout(await rights(), batch, {
    referenceTime: clock,
  })
  assert.equal(report.expectedShapeCount, 6)
  assert.equal(report.historicalAcceptedShapes, 6,
    'the discrepancy does not disappear simply because every adapter is populated')
  assert.equal(report.productionEnabled, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.liveRetailerRequests, 0)
  assert.ok(report.retailers.find(r => r.retailerId === 'plus').nextActions
    .includes('review-conflicting-product-facts'),
  'operator cannot overlook real archived product price/pack/offer/stock conflicts')
  assert.deepEqual(batch, before, 'composing QA must never rewrite synthetic evidence')
})

test('QA negative control: dishonest summary metadata is still rejected before operator rendering', async () => {
  const original = await loadReviewedRepositoryFixtures()
  const batch = syntheticContradictorySnapshot(original)
  batch.summary.permissionVerified = true
  const gate = await rights()
  assert.throws(() => planPrivateRetailerRollout(gate, batch, { referenceTime: clock }),
    /Private retailer adapter health review refused/)
})
