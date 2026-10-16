import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// Offline sanitized historical fixture only; never a current retailer quote.
async function historicalBatch() {
  const archived = await loadReviewedRepositoryFixtures()
  const row = structuredClone(archived.results.find(entry => entry.key === 'plus:product'))
  assert.ok(row?.accepted === true && row.observations.length > 0)
  row.observations = [structuredClone(row.observations[0])]
  return { summary: { mode: 'reviewed-offline-only' }, results: [row] }
}
const blocked = /refus|untrusted|bound|size|limit|large/i

test('ordinary archived PLUS catalog and small multilingual data stay private', async () => {
  const input = await historicalBatch()
  input.results[0].observations[0].name = 'Historisch pak € ñ 漢 ' + 'a'.repeat(256)
  input.summary.privateNote = 'Gebaseerd op historisch bewijs; niet actueel'
  const before = structuredClone(input)
  const catalog = buildUniversalRetailerCatalog(input)
  assert.equal(catalog.status, 'private-review-only')
  assert.equal(catalog.productionEnabled, false)
  assert.equal(catalog.publicSavingsClaimEligible, false)
  assert.ok(catalog.products.length > 0)
  assert.ok(catalog.products.every(item =>
    item.sourceRightsVerified === false &&
    item.currentTrustedPriceCents === null && item.publishable === false))
  assert.deepEqual(input, before)
})

test('single oversized ASCII product name is refused before catalog output', async () => {
  const input = await historicalBatch()
  input.results[0].observations[0].name = 'x'.repeat(65_537)
  assert.throws(() => buildUniversalRetailerCatalog(input), blocked)
})

test('UTF-8 multibyte overhead is counted, not only UTF-16 code units', async () => {
  const input = await historicalBatch()
  const multibyte = '漢'.repeat(25_000)
  assert.ok(multibyte.length < 65_536)
  assert.ok(Buffer.byteLength(multibyte, 'utf8') > 65_536)
  input.summary.extraIgnoredByCatalog = multibyte
  assert.throws(() => buildUniversalRetailerCatalog(input), blocked)
})

test('an unused caller-owned source metadata scalar consumes the byte budget', async () => {
  const input = await historicalBatch()
  input.results[0].observations[0].provenance.qaNeverPublish = 'x'.repeat(1_048_577)
  assert.throws(() => buildUniversalRetailerCatalog(input), blocked)
})

test('many individually bounded fields cannot exceed cumulative graph budget', async () => {
  const input = await historicalBatch()
  input.summary.qaAggregateOnly = Array.from(
    { length: 42 }, (_, i) => 'offline:' + i + ':' + 'x'.repeat(32_000),
  )
  assert.ok(input.summary.qaAggregateOnly.every(item => item.length < 65_536))
  assert.throws(() => buildUniversalRetailerCatalog(input), blocked)
})

test('a long query on a fictional historical source URL is refused', async () => {
  const input = await historicalBatch()
  const row = input.results[0].observations[0]
  row.provenance.url += '?qa_note=' + 'x'.repeat(65_536)
  assert.throws(() => buildUniversalRetailerCatalog(input), blocked)
})

test('a 1MiB invented offer label cannot enter a private candidate', async () => {
  const input = await historicalBatch()
  input.results[0].observations[0].offer = {
    label: 'x'.repeat(1_048_577),
    mechanics: null,
    offerPriceCents: null,
    originalPriceCents: null,
    validFrom: null,
    validTo: null,
  }
  assert.throws(() => buildUniversalRetailerCatalog(input), blocked)
})
