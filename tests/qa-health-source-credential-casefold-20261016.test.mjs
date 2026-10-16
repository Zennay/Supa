/**
 * Independent SUPA M3 QA — exported six-adapter health source provenance.
 * Frozen owner #3235 at 52676be5f9a8934f38a5573f2fbb5515b0bc7fd0.
 * Real repository's six previously reviewed PLUS/Deka shapes, with ONLY
 * fictional synthetic query markers in cloned memory. No network, customer
 * input, real credentials, new source rights, current prices or publication.
 *
 * Direct universal-catalog casefold issue #3209 is separately owned by #3210.
 * This file probes the health API independently, without modifying that
 * owner's script or claiming the direct catalog has been fixed.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'
import { buildBudgetedPrivateRetailerCatalog } from '../scripts/retailer-private-budgeted-catalog.mjs'

const REFERENCE = Object.freeze({
  referenceTime: '2030-01-01T00:00:00Z',
  maxAgeHours: 720,
})
const REFUSAL = /(?:Private retailer adapter health review refused|Untrusted retailer capture source URL|Private offline catalog input refused)/
const genuine = async () => structuredClone(await loadReviewedRepositoryFixtures())

function addSyntheticQuery(batch, query) {
  const source = batch.results.find(item => item.key === 'plus:product')
  assert.ok(source?.accepted && source.observations.length > 0)
  for (const observation of source.observations) {
    const existing = observation.provenance.url
    observation.provenance.url = existing + (existing.includes('?') ? '&' : '?') + query
  }
}

test('health exported API retains historical six-shape private-only positive result', async () => {
  const batch = await genuine()
  const original = structuredClone(batch)
  const health = evaluatePrivateAdapterHealth(batch, REFERENCE)
  assert.equal(health.sources, 6)
  assert.equal(health.acceptedSources, 6)
  assert.equal(health.externalRequests, 0)
  assert.equal(health.productionEnabled, false)
  assert.equal(health.permissionVerified, false)
  assert.equal(health.publicSavingsClaimEligible, false)
  assert.ok(health.operatorActions.includes('obtain-written-retailer-source-rights'))
  assert.deepEqual(batch, original, 'health must not edit reviewed source observations')
  const rendered = JSON.stringify(health)
  assert.doesNotMatch(rendered, /https?:\/\/|sourceProductId|currentPriceCents|offerPriceCents|access_token/i)
})

test('health keeps benign synthetic review query metadata private, no permissions', async () => {
  const batch = await genuine()
  addSyntheticQuery(batch, 'campaign=fictional-qa')
  const health = evaluatePrivateAdapterHealth(batch, REFERENCE)
  assert.equal(health.sources, 6)
  assert.equal(health.productionEnabled, false)
  assert.equal(health.externalRequests, 0)
  assert.doesNotMatch(JSON.stringify(health), /fictional-qa|campaign|https?:\/\//i)
  const catalog = buildBudgetedPrivateRetailerCatalog(batch)
  assert.equal(catalog.sourceCount, 6)
  assert.equal(catalog.publicSavingsClaimEligible, false)
})

for (const [title, query] of [
  ['uppercase query key', 'ACCESS_TOKEN=FICTIONAL_QA_NOT_A_SECRET'],
  ['mixed-case query key', 'AcCeSs_ToKeN=FICTIONAL_QA_NOT_A_SECRET'],
  ['percent-escaped mixed-case query key', 'A%43CESS%5FTOKEN=FICTIONAL_QA_NOT_A_SECRET'],
]) {
  test('health must refuse ' + title + ' before producing trusted historical review [EXPECTED RED]', async () => {
    const batch = await genuine()
    addSyntheticQuery(batch, query)
    const original = structuredClone(batch)
    // The independently fixed budgeted wrapper already has this guard.
    // Health's separately exported API must not silently have weaker trust.
    assert.throws(() => buildBudgetedPrivateRetailerCatalog(batch), REFUSAL)
    assert.throws(() => evaluatePrivateAdapterHealth(batch, REFERENCE), REFUSAL)
    assert.deepEqual(batch, original, 'rejection must not mutate or sanitize caller evidence in place')
  })
}
