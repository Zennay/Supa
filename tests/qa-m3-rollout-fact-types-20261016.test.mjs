/**
 * Independent quality-validation for #3302 remediation: an accepted archived
 * source can conflict on any important grocery fact, not only current cents.
 * All samples are cloned from verified historical fixtures and mutated ONLY
 * in memory. This is not live retailer data, consent or a price publication.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'
import { planPrivateRetailerRollout } from '../scripts/retailer-private-source-rollout-matrix.mjs'

const at = '2026-10-05T02:00:00.000Z'
const gateFile = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)
const gate = async () => JSON.parse(await readFile(gateFile, 'utf8'))
const action = 'review-conflicting-product-facts'

function newSyntheticEvent(batch, key, alteration, digit) {
  const owner = key.split(':')[0]
  const sample = batch.results.find(row => row.key === key && row.accepted === true)
  assert.ok(sample, 'historical fixture must contain this accepted source kind')
  const newer = structuredClone(sample)
  for (const observation of newer.observations) {
    observation.provenance.sha256 = digit.repeat(64)
    observation.provenance.capturedAt = '2026-10-05T00:00:00.000000009Z'
  }
  alteration(newer.observations[0])
  batch.results.push(newer)
  batch.summary.sources += 1
  batch.summary.acceptedSources += 1
  batch.summary.observations += newer.observations.length
  batch.summary.retailerCounts[owner] += newer.observations.length
}

function verifyReportedConflict(batch, summary, affected) {
  const catalogue = buildUniversalRetailerCatalog(batch)
  const health = evaluatePrivateAdapterHealth(batch, { referenceTime: at })
  assert.ok(catalogue.conflictCount > 0)
  assert.equal(health.inconsistentProducts, catalogue.conflictCount)
  assert.equal(summary.historicalConflictingProductCount, catalogue.conflictCount,
    'global human review workload must equal unique inconsistent catalog groups')
  assert.ok(health.operatorActions.includes(action))
  const owner = summary.retailers.find(row => row.retailerId === affected)
  const other = summary.retailers.find(row => row.retailerId !== affected)
  assert.ok(owner && other)
  for (const retailer of [owner, other]) {
    const independentCount = catalogue.products.filter(product =>
      product.retailerId === retailer.retailerId &&
      product.consistency !== 'consistent').length
    assert.equal(retailer.historicalConflictingProductCount, independentCount,
      'review workload must be scoped to independent store catalog counts')
    assert.equal(retailer.nextActions.includes(action), independentCount > 0,
      'operator action must agree with nonzero review workload')
  }
  assert.equal(summary.retailers.reduce((sum, row) =>
    sum + row.historicalConflictingProductCount, 0),
  summary.historicalConflictingProductCount,
  'store-local review counts must reconcile exactly with total')
  assert.ok(owner.nextActions.includes(action),
    'affected retailer must ask the operator to resolve inconsistent historical facts')
  const otherHasCanonicalConflict = catalogue.products.some(product =>
    product.retailerId === other.retailerId && product.consistency !== 'consistent')
  assert.equal(other.nextActions.includes(action), otherHasCanonicalConflict,
    'other retailer must retain its own actual historical baseline conflict state')
  assert.equal(summary.historicalAcceptedShapes, 6)
  assert.equal(summary.permissionVerifiedForNewCapture, false)
  assert.equal(summary.publicSavingsClaimEligible, false)
  assert.equal(summary.liveRetailerRequests, 0)
  assert.equal(summary.productionEnabled, false)
  const disclosed = JSON.stringify(summary)
  assert.doesNotMatch(disclosed, /https?:|currentPriceCents|sourceProductId|snapshotSha256/)
}

for (const [name, key, change, digit] of [
  ['PLUS availability-only contradiction', 'plus:product', observation => {
    observation.availability = observation.availability === 'available'
      ? 'unknown' : 'available'
  }, 'b'],
  ['DekaMarkt packaging-only contradiction', 'dekamarkt:product', observation => {
    observation.pack.rawText = 'Fictional alternate pack label'
  }, 'c'],
  ['PLUS offer-kind label contradiction', 'plus:offers', observation => {
    observation.name = 'Fictional alternate offer display name'
  }, 'd'],
  ['DekaMarkt catalog-kind label contradiction', 'dekamarkt:catalog', observation => {
    observation.name = 'Fictional alternate catalog display name'
  }, 'e'],
]) {
  test('QA: ' + name + ' stays retailer-scoped, private and review-required', async () => {
    const batch = structuredClone(await loadReviewedRepositoryFixtures())
    newSyntheticEvent(batch, key, change, digit)
    const frozen = structuredClone(batch)
    const summary = planPrivateRetailerRollout(await gate(), batch, { referenceTime: at })
    verifyReportedConflict(batch, summary, key.split(':')[0])
    assert.deepEqual(batch, frozen, 'QA cannot rewrite product provenance or amounts')
  })
}

test('QA: original six-shape archive retains canonical historical conflict status without guessing it is clean', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const original = structuredClone(batch)
  const canonical = buildUniversalRetailerCatalog(batch)
  const summary = planPrivateRetailerRollout(await gate(), batch, { referenceTime: at })
  assert.equal(summary.historicalConflictingProductCount, canonical.conflictCount)
  for (const store of summary.retailers) {
    const catalogHasConflict = canonical.products.some(product =>
      product.retailerId === store.retailerId && product.consistency !== 'consistent')
    const storeCount = canonical.products.filter(product =>
      product.retailerId === store.retailerId && product.consistency !== 'consistent').length
    assert.equal(store.historicalConflictingProductCount, storeCount)
    assert.equal(store.nextActions.includes(action), catalogHasConflict)
    assert.equal(store.currentPricePublicationAllowed, false)
  }
  assert.equal(summary.publicSavingsClaimEligible, false)
  assert.equal(summary.liveRetailerRequests, 0)
  assert.deepEqual(batch, original)
})
