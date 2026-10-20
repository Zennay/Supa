import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { reviewPrivateHtmlRetailerBatch } from '../scripts/retailer-private-html-four-source-review.mjs'

const FIXTURES = [
  'plus-rendered-product-halfvolle-melk.v1.json',
  'dekamarkt-product-halfvolle-melk.v1.json',
  'dekamarkt-catalog-melk.v1.json',
  'dekamarkt-offers.v1.json',
]

async function archive(name) {
  return JSON.parse(await readFile(new URL('../fixtures/m1/' + name, import.meta.url), 'utf8'))
}

// Fictional replay wrappers around existing historical sanitized STRUCTURES,
// not actual previously captured retailer HTML or source reuse permission.
async function syntheticPair(name, suffix = '') {
  const reviewedEvidence = await archive(name)
  const scripts = []
  if (reviewedEvidence.jsonLd) scripts.push('<script type="application/ld+json">' +
    JSON.stringify(reviewedEvidence.jsonLd) + '</script>')
  if (reviewedEvidence.nuxtPayload) scripts.push('<script id="__NUXT_DATA__">' +
    JSON.stringify(reviewedEvidence.nuxtPayload) + '</script>')
  if (reviewedEvidence.jsonLdProduct) scripts.push('<script type="application/ld+json">' +
    JSON.stringify(reviewedEvidence.jsonLdProduct) + '</script>')
  const html = '<html><head>' + scripts.join('') + '</head><body></body></html>' + suffix
  const bytes = Buffer.byteLength(html)
  const sha256 = createHash('sha256').update(html).digest('hex')
  reviewedEvidence.source.sha256 = sha256
  if (reviewedEvidence.browserEvidence) reviewedEvidence.browserEvidence.renderedHtmlSha256 = sha256
  if (reviewedEvidence.captureEvidence) reviewedEvidence.captureEvidence.bytes = bytes
  return {
    captured: {
      mode: 'authorized-one-page-capture-needs-review',
      source: {
        retailerId: reviewedEvidence.source.supermarket, kind: reviewedEvidence.source.kind,
        url: reviewedEvidence.source.url,
        capturedAt: reviewedEvidence.source.capturedAt,
        sha256,
      },
      bytes, html,
      permissionVerifiedForThisRequest: true, normalized: false,
      readyForIngestion: false, published: false,
    },
    reviewedEvidence,
  }
}

async function allPairs() {
  return Promise.all(FIXTURES.map(name => syntheticPair(name)))
}

const clock = { referenceTime: '2026-10-16T11:00:00Z', maxAgeHours: 24 }

test('four real M1 adapter types pass bounded private HTML batch, but MUST NOT claim six-source readiness', async () => {
  const entries = await allPairs()
  const result = reviewPrivateHtmlRetailerBatch(entries, clock)
  assert.equal(result.mode, 'private-offline-four-source-html-review')
  assert.equal(result.verifiedHtmlSources, 4)
  assert.equal(result.supportedSourceKinds, 4)
  assert.ok(result.normalizedObservationCount >= 6)
  assert.ok(result.retailerObservationCounts.plus > 0)
  assert.ok(result.retailerObservationCounts.dekamarkt > 0)
  assert.deepEqual(result.missingSourceKinds, ['plus:catalog','plus:offers'])
  assert.equal(result.sixSourceCoverageComplete, false)
  assert.ok(result.historicalStaleSources > 0)
  assert.ok(result.operatorActions.includes('review-missing-source-shapes'))
  assert.ok(result.operatorActions.includes('obtain-written-retailer-source-rights'))
  assert.equal(result.rightsVerifiedForReuse, false)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.livePricesAvailable, false)
  assert.equal(result.externalRequests, 0)
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /currentPriceCents|pricePerPackCents|sourceProductId|https?:\/\/|Zuivelmeester|@|cookie|token/i)
})

test('batch rejects duplicate physical captures and incomplete four-shape proof', async () => {
  const entries = await allPairs()
  assert.throws(() => reviewPrivateHtmlRetailerBatch([...entries.slice(0, 3)]), /batch review refused/)
  assert.throws(() => reviewPrivateHtmlRetailerBatch([entries[0], entries[1], entries[1], entries[3]]), /batch review refused/)
  assert.throws(() => reviewPrivateHtmlRetailerBatch([...entries, entries[2]]), /batch review refused/)
  assert.equal(reviewPrivateHtmlRetailerBatch(entries, clock).sixSourceCoverageComplete, false)
})

test('bad source bytes, mismatched record and stale/future clock are never output as facts', async () => {
  const original = await allPairs()
  const wrong=structuredClone(original)
  wrong[0].captured.html += '\n'
  assert.throws(() => reviewPrivateHtmlRetailerBatch(wrong, clock), /batch review refused/)
  const mismatch=structuredClone(original)
  mismatch[2].reviewedEvidence.source.capturedAt='2025-10-16T11:00:00Z'
  assert.throws(() => reviewPrivateHtmlRetailerBatch(mismatch, clock), /batch review refused/)
  assert.throws(() => reviewPrivateHtmlRetailerBatch(original,
    {referenceTime:'2026-10-01T11:00:00Z'}), /batch review refused/)
})

test('no caller accessors, forged options, sparse entries or revoked Proxy can execute', async () => {
  const entries = await allPairs()
  let calls = 0
  const accessor = { ...entries[0] }
  Object.defineProperty(accessor, 'captured', {
    enumerable: true, get() { calls++; throw new Error('leak') },
  })
  assert.throws(() => reviewPrivateHtmlRetailerBatch([accessor, ...entries.slice(1)], clock), /batch review refused/)
  assert.equal(calls,0)
  const sparse = new Array(4)
  sparse[0]=entries[0]
  assert.throws(() => reviewPrivateHtmlRetailerBatch(sparse, clock), /batch review refused/)
  const revocable = Proxy.revocable(entries, {})
  revocable.revoke()
  assert.throws(() => reviewPrivateHtmlRetailerBatch(revocable.proxy, clock), /batch review refused/)
  const forged = { ...clock }
  Object.defineProperty(forged, 'referenceTime', { get() { calls++; return clock.referenceTime } })
  assert.throws(() => reviewPrivateHtmlRetailerBatch(entries, forged), /batch review refused/)
  assert.equal(calls,0)
  assert.throws(() => reviewPrivateHtmlRetailerBatch(entries, {...clock,productionEnabled:true}), /batch review refused/)
})

test('review batch stays deterministic on same four synthetic SHA-locked historical sources', async () => {
  const entries = await allPairs()
  const first = reviewPrivateHtmlRetailerBatch(entries, clock)
  const second = reviewPrivateHtmlRetailerBatch(structuredClone(entries), clock)
  assert.deepEqual(first, second)
  assert.equal(first.verifiedHtmlSources, 4)
})
