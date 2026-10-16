/**
 * Independent M3 QA: the operator rollout matrix, six-shape health, catalog,
 * and written-rights gate must agree on one *offline* historical evidence set.
 * No network access, permissions promotion, product-source edits, or prices.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { evaluateSourcePermissionGate } from '../scripts/m1-check-source-permission-gate.mjs'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'
import { planPrivateRetailerRollout } from '../scripts/retailer-private-source-rollout-matrix.mjs'

const rightsFile = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)
const rights = async () => JSON.parse(await readFile(rightsFile, 'utf8'))
const initial = '2026-10-05T00:00:00.000Z'
const later = '2026-10-15T21:00:00.000Z'
const allKeys = ['plus:product', 'plus:catalog', 'plus:offers',
  'dekamarkt:product', 'dekamarkt:catalog', 'dekamarkt:offers']
const projected = (report) => report.retailers.flatMap(store =>
  store.shapes.map(shape => [store.retailerId + ':' + shape.kind, shape]))

test('QA integration: independently calculated catalog, source health and rollout cover exactly the same six archived source shapes', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const original = structuredClone(batch)
  const gate = await rights()
  const permission = evaluateSourcePermissionGate(gate)
  const health = evaluatePrivateAdapterHealth(batch, { referenceTime: initial })
  const catalog = buildUniversalRetailerCatalog(batch)
  const report = planPrivateRetailerRollout(gate, batch, { referenceTime: initial })

  assert.deepEqual(Object.keys(health.byShape).sort(), [...allKeys].sort())
  assert.deepEqual(projected(report).map(([key]) => key).sort(), [...allKeys].sort())
  assert.equal(report.historicalAcceptedShapes, 6)
  assert.equal(report.expectedShapeCount, 6)
  assert.equal(report.historicalAcceptedShapes,
    Object.values(health.byShape).filter(shape => shape.accepted > 0).length)
  assert.equal(report.staleHistoricalCaptures, health.staleSources)
  assert.equal(health.acceptedSources, batch.summary.acceptedSources)
  assert.equal(health.observations, batch.summary.observations)
  assert.equal(catalog.captureCount, health.captureEvents)
  assert.equal(catalog.productCount, health.products)
  assert.equal(report.rightsGateProductionReady, permission.productionReady)
  assert.equal(report.rightsGateProductionReady, false)

  for (const [key, shape] of projected(report)) {
    const entry = health.byShape[key]
    assert.equal(shape.historicalSources, entry.sources, key)
    assert.equal(shape.acceptedSources, entry.accepted, key)
    assert.equal(shape.rejectedSources, entry.rejected, key)
    assert.equal(shape.historicalObservations, entry.observations, key)
    assert.equal(shape.unknownPriceObservations, entry.unknownPrices, key)
    assert.equal(shape.staleHistoricalCaptures, entry.staleCaptures, key)
    assert.equal(shape.eligibleForLiveCapture, false, key)
    assert.equal(shape.verifiedCurrentPriceObservations, 0, key)
  }
  assert.deepEqual(batch, original, 'read-only QA must not mutate archived inputs')
})

test('QA integration: ageing captures stay archived and unlicensed in every output, never become verified prices', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const gate = await rights()
  const old = planPrivateRetailerRollout(gate, batch, { referenceTime: initial })
  const stale = planPrivateRetailerRollout(gate, batch, { referenceTime: later })
  const freshHealth = evaluatePrivateAdapterHealth(batch, { referenceTime: initial })
  const staleHealth = evaluatePrivateAdapterHealth(batch, { referenceTime: later })
  assert.equal(old.staleHistoricalCaptures, freshHealth.staleSources)
  assert.equal(stale.staleHistoricalCaptures, staleHealth.staleSources)
  assert.equal(stale.staleHistoricalCaptures > old.staleHistoricalCaptures, true)
  for (const report of [old, stale]) {
    assert.equal(report.liveScrapingEnabled, false)
    assert.equal(report.scheduledRefreshEnabled, false)
    assert.equal(report.permissionVerifiedForNewCapture, false)
    assert.equal(report.productionEnabled, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.liveRetailerRequests, 0)
    for (const retailer of report.retailers) {
      assert.equal(retailer.currentPricePublicationAllowed, false)
      for (const kind of retailer.shapes) {
        assert.equal(kind.verifiedCurrentPriceObservations, 0)
        assert.equal(kind.eligibleForLiveCapture, false)
      }
    }
    const output = JSON.stringify(report)
    assert.doesNotMatch(output, /https?:|sha256|currentPriceCents|offerPriceCents|sourceProductId/i)
  }
})

test('QA integration: even synthetic written permission cannot turn an offline catalog matrix into live scraping', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const gate = await rights()
  for (const source of gate.sources) {
    source.permissionStatus = 'permitted'
    source.productionEnabled = true
    source.evidence.push({
      kind: 'written_permission',
      url: 'https://example.invalid/synthetic-not-a-real-license',
      finding: 'Synthetic QA marker, no real grant',
    })
  }
  // This is ONLY a synthetic structural gate test. It does not establish
  // actual retailer permission and must not be persisted as real evidence.
  assert.equal(evaluateSourcePermissionGate(gate).productionReady, true)
  const report = planPrivateRetailerRollout(gate, batch, { referenceTime: initial })
  assert.equal(report.rightsGateProductionReady, true)
  assert.equal(report.historicalAcceptedShapes, 6)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.liveScrapingEnabled, false)
  assert.equal(report.scheduledRefreshEnabled, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.permissionVerifiedForNewCapture, false)
  assert.equal(report.liveRetailerRequests, 0)
  for (const store of report.retailers) {
    assert.equal(store.liveScrapingEnabled, false)
    assert.equal(store.scheduledRefreshEnabled, false)
    assert.equal(store.currentPricePublicationAllowed, false)
    for (const shape of store.shapes) {
      assert.equal(shape.eligibleForLiveCapture, false)
      assert.equal(shape.verifiedCurrentPriceObservations, 0)
    }
  }
})

test('QA integration: forged six-shape health summaries cannot produce an operator-ready matrix', async () => {
  const gate = await rights()
  const batch = await loadReviewedRepositoryFixtures()
  for (const [name, tamper] of [
    ['accepted source count', b => { b.summary.acceptedSources += 1 }],
    ['false production eligibility', b => { b.summary.productionEnabled = true }],
    ['false permission', b => { b.summary.permissionVerified = true }],
    ['false savings eligibility', b => { b.summary.publicSavingsClaimEligible = true }],
    ['false observation count', b => { b.summary.observations += 1 }],
    ['false retailer count', b => { b.summary.retailerCounts.dekamarkt += 1 }],
  ]) {
    const bad = structuredClone(batch)
    tamper(bad)
    assert.throws(
      () => planPrivateRetailerRollout(gate, bad, { referenceTime: initial }),
      undefined, name)
  }
})
