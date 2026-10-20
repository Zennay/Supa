import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'
import { auditPrivateCrossStoreEvidence } from '../scripts/qa-retailer-cross-store-source-coverage.mjs'

const clock = '2026-10-15T00:00:00.000Z'
const options = { asOf: clock, maxAgeHours: 24, maxCrossStoreSkewHours: 24 }
const denied = /Private retailer cross-store source coverage QA refused/
async function historical() {
  return buildUniversalRetailerCatalog(await loadReviewedRepositoryFixtures())
}

test('six original M1 historical capture shapes keep offline cross-store QA private and immutable', async () => {
  const catalog = await historical()
  const before = structuredClone(catalog)
  const report = auditPrivateCrossStoreEvidence(catalog, options)
  assert.equal(report.schemaVersion, 1)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.permissionVerified, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.livePricesAvailable, false)
  assert.equal(report.verifiedEquivalentProducts, 0)
  assert.equal(report.verifiedPriceComparisons, 0)
  assert.deepEqual(catalog, before)
})

for (const key of ['asOf', 'maxAgeHours', 'maxCrossStoreSkewHours']) {
  test('review option getter ' + key + ' may not execute before boundary check', async () => {
    const catalog = await historical()
    const supplied = { ...options }
    let executed = 0
    Object.defineProperty(supplied, key, {
      enumerable: true, configurable: true,
      get() {
        executed++
        throw new Error('ACTIVE_CROSS_STORE_REVIEW_OPTION_GETTER')
      },
    })
    assert.throws(() => auditPrivateCrossStoreEvidence(catalog, supplied), denied)
    assert.equal(executed, 0)
  })
}

test('Proxy-wrapped direct cross-store review options cannot run get traps', async () => {
  const catalog = await historical()
  let traps = 0
  const supplied = new Proxy(options, {
    get() {
      traps++
      throw new Error('ACTIVE_CROSS_STORE_REVIEW_OPTION_PROXY')
    },
  })
  assert.throws(() => auditPrivateCrossStoreEvidence(catalog, supplied), denied)
  assert.equal(traps, 0)
})

test('inherited/asymmetric review windows are refused before trust promotion', async () => {
  const catalog = await historical()
  const inherited = Object.create({ asOf: clock })
  assert.throws(() => auditPrivateCrossStoreEvidence(catalog, inherited), denied)
  for (const bad of [null, [], false, { asOf: clock, unknown: 'policy-bypass' }]) {
    assert.throws(() => auditPrivateCrossStoreEvidence(catalog, bad), denied)
  }
})

test('independent explicit bounded review windows remain valid and nonpublishable', async () => {
  const catalog = await historical()
  const before = auditPrivateCrossStoreEvidence(catalog, options)
  const after = auditPrivateCrossStoreEvidence(catalog, {
    maxCrossStoreSkewHours: 48,
    maxAgeHours: 48,
    asOf: clock,
  })
  assert.equal(after.candidatePairs, before.candidatePairs)
  assert.equal(after.productionEnabled, false)
  assert.equal(after.publicSavingsClaimEligible, false)
  assert.equal(after.humanReviewRequired, true)
})
