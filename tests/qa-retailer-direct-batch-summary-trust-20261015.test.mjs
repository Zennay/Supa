import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// Independent QA against the exported direct catalog boundary (not the
// separately stricter SQLite importer). All inputs are bundled, offline,
// historical PLUS/DekaMarkt records; no live HTTP, permission or public price.
async function completeBatch() {
  const batch = await loadReviewedRepositoryFixtures()
  assert.equal(batch.summary.sources, 6)
  assert.equal(batch.summary.acceptedSources, 6)
  assert.equal(batch.summary.rejectedSources, 0)
  assert.equal(batch.summary.productionEnabled, false)
  assert.equal(batch.summary.permissionVerified, false)
  assert.equal(batch.summary.publicSavingsClaimEligible, false)
  return batch
}

test('control: all six original private sources form a two-retailer, never-publishable catalog', async () => {
  const batch = await completeBatch()
  const original = structuredClone(batch)
  const catalog = buildUniversalRetailerCatalog(batch)
  assert.deepEqual(batch, original, 'catalog projection must leave source facts untouched')
  assert.equal(catalog.sourceCount, 6)
  assert.equal(catalog.captureCount, batch.summary.observations)
  assert.equal(catalog.status, 'private-review-only')
  assert.equal(catalog.productionEnabled, false)
  assert.equal(catalog.publicSavingsClaimEligible, false)
  assert.deepEqual(new Set(catalog.products.map(p => p.retailerId)),
    new Set(['plus', 'dekamarkt']))
  for (const p of catalog.products) {
    assert.equal(p.publishable, false)
    assert.equal(p.sourceRightsVerified, false)
    assert.equal(p.currentTrustedPriceCents, null)
    assert.equal(p.selectedSnapshotSha256, null)
  }
})

test('direct catalog must refuse privilege-bearing metadata that contradicts original private evidence', async t => {
  const cases = [
    ['forged production activation', b => { b.summary.productionEnabled = true }],
    ['forged retailer consent', b => { b.summary.permissionVerified = true }],
    ['forged public financial claim', b => { b.summary.publicSavingsClaimEligible = true }],
  ]
  for (const [label, alter] of cases) {
    await t.test(label, async () => {
      const forged = await completeBatch()
      alter(forged)
      assert.throws(() => buildUniversalRetailerCatalog(forged),
        /refus|private|permission|production|claim|batch|source/i,
        'contradictory batch summary must fail closed before catalog projection')
    })
  }
})

test('direct catalog must refuse inconsistent completeness and observation counters', async t => {
  const cases = [
    ['source count inconsistent with physical source results', b => { b.summary.sources = 99 }],
    ['accepted count understated', b => { b.summary.acceptedSources = 1 }],
    ['rejected source declared but all results accepted', b => { b.summary.rejectedSources = 1 }],
    ['observation count inconsistent with underlying observations', b => { b.summary.observations += 1 }],
  ]
  for (const [label, alter] of cases) {
    await t.test(label, async () => {
      const forged = await completeBatch()
      alter(forged)
      assert.throws(() => buildUniversalRetailerCatalog(forged),
        /refus|count|batch|source|observation/i,
        'incompatible source summary cannot support a complete catalog claim')
    })
  }
})
