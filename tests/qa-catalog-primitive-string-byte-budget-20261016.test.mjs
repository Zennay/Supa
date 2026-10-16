import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// Independent quality-validation on the exported JS *offline private* catalog.
// The source object/node count is capped, but giant individual primitive
// strings can escape that budget. Three local 1-MiB-only test inputs exercise
// source fact names, offer labels and HTTPS provenance query size. No actual
// retailer HTTP, current product price, secret, customer or public saving.
const HUGE = 'X'.repeat(1024 * 1024 + 1)
const oversizedError = /refus|untrusted|bounded|oversiz|large|size|limit|too long/i

async function oneHistoricalSource() {
  const archived = await loadReviewedRepositoryFixtures()
  const source = structuredClone(archived.results.find(r => r.key === 'plus:product'))
  assert.ok(source?.accepted && source.observations.length)
  source.observations = [structuredClone(source.observations[0])]
  return { summary: { mode: 'reviewed-offline-only' }, results: [source] }
}

function assertPrivateOnly(catalog) {
  assert.equal(catalog.status, 'private-review-only')
  assert.equal(catalog.productionEnabled, false)
  assert.equal(catalog.publicSavingsClaimEligible, false)
  assert.equal(catalog.sourceCount, 1)
  for (const product of catalog.products) {
    assert.equal(product.publishable, false)
    assert.equal(product.sourceRightsVerified, false)
    assert.equal(product.currentTrustedPriceCents, null)
  }
}

test('control: historical PLUS and ordinary safe names remain private', async () => {
  const input = await oneHistoricalSource()
  const before = structuredClone(input)
  assertPrivateOnly(buildUniversalRetailerCatalog(input))
  assert.deepEqual(input, before)
  input.results[0].observations[0].name = 'Offline sample ' + 'A'.repeat(256)
  assertPrivateOnly(buildUniversalRetailerCatalog(input))
})

test('one 1-MiB product name must be bounded before private catalog assembly [EXPECTED RED]', async () => {
  const input = await oneHistoricalSource()
  input.results[0].observations[0].name = HUGE
  assert.throws(() => buildUniversalRetailerCatalog(input), oversizedError)
})

test('one 1-MiB fictional offer label cannot bypass the caller byte budget [EXPECTED RED]', async () => {
  const input = await oneHistoricalSource()
  input.results[0].observations[0].offer = {
    label: HUGE,
    mechanics: null,
    offerPriceCents: null,
    originalPriceCents: null,
    validFrom: '2026-10-01T00:00:00Z',
    validTo: '2026-10-15T23:00:00Z',
  }
  assert.throws(() => buildUniversalRetailerCatalog(input), oversizedError)
})

test('one 1-MiB benign HTTPS source query cannot bypass a global provenance string cap [EXPECTED RED]', async () => {
  const input = await oneHistoricalSource()
  const observation = input.results[0].observations[0]
  const url = new URL(observation.provenance.url)
  url.searchParams.set('offline_label', HUGE)
  observation.provenance.url = url.toString()
  assert.equal(new URL(observation.provenance.url).hostname, 'www.plus.nl')
  assert.throws(() => buildUniversalRetailerCatalog(input), oversizedError)
})
