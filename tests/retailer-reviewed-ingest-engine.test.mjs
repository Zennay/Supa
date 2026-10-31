import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  RETAILER_REVIEWED_FIXTURES,
  ingestReviewedEvidence,
  ingestReviewedBatch,
  loadReviewedRepositoryFixtures,
  main,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'

async function fixture(name) {
  return JSON.parse(await readFile(new URL('../fixtures/m1/' + name, import.meta.url), 'utf8'))
}

test('six independently reviewed PLUS/DekaMarkt product/catalog/offer adapters run end-to-end in one OFFLINE batch', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  assert.equal(RETAILER_REVIEWED_FIXTURES.length, 6)
  assert.deepEqual(batch.results.map(x => x.key), [
    'plus:product', 'plus:catalog', 'plus:offers',
    'dekamarkt:product', 'dekamarkt:catalog', 'dekamarkt:offers',
  ])
  assert.equal(batch.summary.mode, 'reviewed-offline-only')
  assert.equal(batch.summary.sources, 6)
  assert.equal(batch.summary.acceptedSources, 6)
  assert.equal(batch.summary.rejectedSources, 0)
  assert.ok(batch.summary.observations >= 12)
  assert.ok(batch.summary.retailerCounts.plus >= 9)
  assert.ok(batch.summary.retailerCounts.dekamarkt >= 4)
  assert.equal(batch.summary.productionEnabled, false)
  assert.equal(batch.summary.permissionVerified, false)
  assert.equal(batch.summary.publicSavingsClaimEligible, false)
  for (const result of batch.results) {
    assert.equal(result.accepted, true, result.key)
    assert.ok(result.observations.length > 0)
    for (const obs of result.observations) {
      assert.match(obs.provenance.sha256, /^[a-f0-9]{64}$/)
      assert.match(obs.provenance.url, /^https:\/\//)
      assert.ok(Number.isFinite(Date.parse(obs.provenance.capturedAt)))
      assert.equal(obs.currency, 'EUR')
      // Valid reviewed product identity can lack a concrete checkout pack
      // price; never invent a price from unit-only Schema.org evidence.
      assert.ok(obs.currentPriceCents === null ||
        Number.isSafeInteger(obs.currentPriceCents))
      assert.equal(obs.supermarket + ':' + obs.provenance.kind, result.key)
    }
  }
})

test('unrecognized retailer/shape, fabricated source identity and empty batches refuse before any source is accepted', async () => {
  const actual = await fixture(RETAILER_REVIEWED_FIXTURES[0])
  assert.throws(() => ingestReviewedEvidence({ ...actual, source: { ...actual.source, supermarket: 'jumbo' } }), /Unapproved/)
  assert.throws(() => ingestReviewedEvidence({ ...actual, evidenceType: 'invented-adapter' }), /Unapproved/)
  assert.throws(() => ingestReviewedEvidence({ ...actual, source: { ...actual.source, id: '../unsafe' } }), /Unsafe/)
  assert.throws(() => ingestReviewedBatch([]), /1–32/)
  assert.throws(() => ingestReviewedBatch(Array.from({ length: 33 }, () => actual)), /1–32/)
  assert.throws(() => ingestReviewedBatch([actual, structuredClone(actual)]), /Duplicate reviewed/)
})

test('source hash, retailer source hostname and bounded capture safety cannot silently turn counterfeit input into observations', async () => {
  const plus = await fixture('plus-rendered-product-halfvolle-melk.v1.json')
  const poisoned = structuredClone(plus)
  poisoned.source.sha256 = 'f'.repeat(64)
  assert.equal(ingestReviewedEvidence(poisoned).accepted, false)
  assert.deepEqual(ingestReviewedEvidence(poisoned).observations, [])
  const redirected = structuredClone(plus)
  redirected.source.url = 'https://invalid.example/product/1'
  assert.equal(ingestReviewedEvidence(redirected).accepted, false)
  const unsafe = structuredClone(plus)
  unsafe.browserEvidence.safety.antiBotBypass = true
  assert.equal(ingestReviewedEvidence(unsafe).accepted, false)
  // Exact same source.id MUST be rejected regardless of parser success.
  assert.throws(() => ingestReviewedBatch([plus, unsafe]), /Duplicate reviewed/)
})

test('no live network, source paths or prices are exposed by the aggregate CLI', async () => {
  const chunks = []
  const result = await main([], text => { chunks.push(String(text)); return true })
    assert.equal(result.acceptedSources, 6)
    const output = chunks.join('')
    assert.deepEqual(JSON.parse(output), result)
    assert.doesNotMatch(output, /https?:\/\/|Zuivelmeester|@|productId|sourceProductId|currentPriceCents|pricePerPackCents|cookie|token/i)
    assert.equal(result.productionEnabled, false)
  await assert.rejects(() => main(['https://www.plus.nl'], () => {}), /Usage:/)
})
