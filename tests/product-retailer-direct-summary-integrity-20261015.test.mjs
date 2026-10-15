import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

test('direct product catalog preserves all six reviewed source metadata and private flags', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const untouched = structuredClone(batch)
  const catalog = buildUniversalRetailerCatalog(batch)
  assert.deepEqual(batch, untouched)
  assert.equal(catalog.sourceCount, 6)
  assert.equal(catalog.captureCount, batch.summary.observations)
  assert.deepEqual(new Set(catalog.products.map(row => row.retailerId)),
    new Set(['plus', 'dekamarkt']))
  assert.equal(catalog.productionEnabled, false)
  assert.equal(catalog.publicSavingsClaimEligible, false)
  for (const p of catalog.products) {
    assert.equal(p.publishable, false)
    assert.equal(p.sourceRightsVerified, false)
    assert.equal(p.currentTrustedPriceCents, null)
  }
})

test('direct catalog rejects present authorization and counter contradictions', async t => {
  const mutations = [
    ['productionEnabled', b => { b.summary.productionEnabled = true }],
    ['permissionVerified', b => { b.summary.permissionVerified = true }],
    ['publicSavingsClaimEligible', b => { b.summary.publicSavingsClaimEligible = true }],
    ['sources', b => { b.summary.sources = 99 }],
    ['acceptedSources', b => { b.summary.acceptedSources = 1 }],
    ['rejectedSources', b => { b.summary.rejectedSources = 1 }],
    ['observations', b => { b.summary.observations++ }],
    ['retailerCounts', b => { b.summary.retailerCounts.plus++ }],
  ]
  for (const [name, edit] of mutations) {
    await t.test(name, async () => {
      const input = await loadReviewedRepositoryFixtures()
      edit(input)
      assert.throws(() => buildUniversalRetailerCatalog(input),
        /Refusing contradictory|Refusing untrusted/i)
    })
  }
})

test('direct catalog preserves intentionally minimal private summary API', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  batch.summary = { mode: 'reviewed-offline-only' }
  const result = buildUniversalRetailerCatalog(batch)
  assert.equal(result.status, 'private-review-only')
  assert.equal(result.sourceCount, 6)
  assert.equal(result.publicSavingsClaimEligible, false)
})

test('direct catalog refuses all truthy, string or nonboolean supplied trust flags', async t => {
  for (const value of ['false', 0, 1, null, undefined, 'permitted']) {
    await t.test(String(value), async () => {
      const batch = await loadReviewedRepositoryFixtures()
      batch.summary.permissionVerified = value
      assert.throws(() => buildUniversalRetailerCatalog(batch), /Refusing untrusted/)
    })
  }
})
