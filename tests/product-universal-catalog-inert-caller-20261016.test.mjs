import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// Product owner tests are independent of immutable QA 3187's original
// 6 expected REDs. Only local archived captures, never live retailer HTTP.
test('actual six reviewed PLUS/Deka sources still build a private catalog deterministically', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const before = structuredClone(batch)
  const catalog = buildUniversalRetailerCatalog(batch)
  assert.equal(catalog.sourceCount, 6)
  assert.equal(catalog.status, 'private-review-only')
  assert.equal(catalog.productionEnabled, false)
  assert.equal(catalog.publicSavingsClaimEligible, false)
  assert.ok(catalog.productCount > 0)
  assert.deepEqual(batch, before)
  assert.deepEqual(buildUniversalRetailerCatalog(batch), catalog)
})

test('caller arrays reject getters, holes, symbol metadata and nested Proxy without trap execution', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  let called = 0
  const getterBatch = structuredClone(batch)
  Object.defineProperty(getterBatch.results, '0', {
    enumerable: true,
    configurable: true,
    get() { called++; return batch.results[0] },
  })
  assert.throws(() => buildUniversalRetailerCatalog(getterBatch), /Untrusted retailer catalog/)
  assert.equal(called, 0)

  const proxyBatch = structuredClone(batch)
  proxyBatch.results[0].observations = new Proxy(proxyBatch.results[0].observations, {
    ownKeys() { called++; throw new Error('caller array trap') },
    get() { called++; throw new Error('caller array trap') },
  })
  assert.throws(() => buildUniversalRetailerCatalog(proxyBatch), /Untrusted retailer catalog/)
  assert.equal(called, 0)

  const hole = structuredClone(batch)
  delete hole.results[0].observations[0]
  assert.throws(() => buildUniversalRetailerCatalog(hole), /Untrusted retailer catalog/)
  const symbol = structuredClone(batch)
  symbol.summary[Symbol('secret approval')] = 'approved'
  assert.throws(() => buildUniversalRetailerCatalog(symbol), /Untrusted retailer catalog/)
})

test('direct catalog rejects inherited approval, cyclic facts and foreign prototypes', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const inherited = structuredClone(batch)
  const parent = { productionEnabled: true }
  Object.setPrototypeOf(inherited.summary, parent)
  assert.throws(() => buildUniversalRetailerCatalog(inherited), /Untrusted retailer catalog/)
  const cyclic = structuredClone(batch)
  cyclic.results[0].observations[0].self = cyclic
  assert.throws(() => buildUniversalRetailerCatalog(cyclic), /Untrusted retailer catalog/)
  const foreign = structuredClone(batch)
  foreign.results[0].observations[0].pack = new Date()
  assert.throws(() => buildUniversalRetailerCatalog(foreign), /Untrusted retailer catalog/)
})

test('a caller cannot use nonfinite money, oversized arrays or unknown injected fields', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const nonfinite = structuredClone(batch)
  nonfinite.results[0].observations[0].currentPriceCents = Number.POSITIVE_INFINITY
  assert.throws(() => buildUniversalRetailerCatalog(nonfinite), /Untrusted retailer catalog/)
  const excessive = structuredClone(batch)
  excessive.results[0].observations[0].injected = Array(16385).fill(0)
  assert.throws(() => buildUniversalRetailerCatalog(excessive), /Untrusted retailer catalog/)
})
