import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// Independent QA 2/2 extension for product issue #3216. All strings/arrays
// are fictional and offline. These cases force a *UTF-8 byte* and cumulative
// primitive budget, not an ASCII-only or merely per-field character limit.
// Original three RED assertions in sibling test source remain UNCHANGED.
const oversize = /refus|untrusted|bounded|oversiz|large|size|limit|too long/i

async function oneHistoricalSource() {
  const historic = await loadReviewedRepositoryFixtures()
  const row = structuredClone(historic.results.find(r => r.key === 'plus:product'))
  assert.ok(row?.accepted === true && row.observations.length)
  row.observations = [structuredClone(row.observations[0])]
  return { summary: { mode: 'reviewed-offline-only' }, results: [row] }
}

function neverPublish(result) {
  assert.equal(result.status, 'private-review-only')
  assert.equal(result.productionEnabled, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  for (const product of result.products) {
    assert.equal(product.sourceRightsVerified, false)
    assert.equal(product.publishable, false)
    assert.equal(product.currentTrustedPriceCents, null)
  }
}

test('control: modest UTF-8 labels and optional inert metadata stay private', async () => {
  const input = await oneHistoricalSource()
  input.results[0].observations[0].name = 'Historische € € € testverpakking'
  input.summary.qaNote = 'alleen offline review'
  const before = structuredClone(input)
  neverPublish(buildUniversalRetailerCatalog(input))
  assert.deepEqual(input, before)
})

test('1.4 MiB in fewer UTF-16 code units must be charged as UTF-8 bytes [EXPECTED RED]', async () => {
  const input = await oneHistoricalSource()
  const multi = 'é'.repeat(700000)
  assert.ok(multi.length < 1024 * 1024)
  assert.ok(Buffer.byteLength(multi, 'utf8') > 1024 * 1024)
  input.results[0].observations[0].name = multi
  assert.throws(() => buildUniversalRetailerCatalog(input), oversize)
})

test('unused own summary metadata with one giant scalar must count towards bounded caller graph [EXPECTED RED]', async () => {
  const input = await oneHistoricalSource()
  input.summary.privateExtraReviewNote = 'x'.repeat(1024 * 1024 + 1)
  assert.throws(() => buildUniversalRetailerCatalog(input), oversize)
})

test('two MiB spread across many individually small strings must exhaust the total byte budget [EXPECTED RED]', async () => {
  const input = await oneHistoricalSource()
  input.summary.privateExtraReviewNotes = Array.from(
    { length: 1024 }, (_, i) => 'offline-' + i + ':' + 'x'.repeat(2048),
  )
  assert.ok(input.summary.privateExtraReviewNotes.every(x => x.length < 4096))
  assert.throws(() => buildUniversalRetailerCatalog(input), oversize)
})
