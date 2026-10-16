import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createAuthorizedRetailerProductPreviewSession } from '../scripts/retailer-authorized-product-preview.mjs'

const captureAt = '2026-10-14T12:00:00.000Z'
const urlOf = retailer => retailer === 'plus'
  ? 'https://www.plus.nl/product/fictional-milk'
  : 'https://www.dekamarkt.nl/producten/fictional-milk'
const request = (retailer = 'plus') => {
  const url = urlOf(retailer)
  return {
    source: { supermarket: retailer, kind: 'product', url },
    capturedAt: captureAt,
    permissionGate: {
      version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-14',
      sources: ['plus', 'dekamarkt'].map(supermarket => ({
        supermarket, technicalStatus: 'proven',
        // FICTIONAL grant for offline Node mock only, never a true license.
        permissionStatus: 'permitted', productionEnabled: true,
        evidence: [{
          kind: 'written_permission',
          url: 'https://example.test/fictional-ci-only-not-a-license',
          finding: 'FICTIONAL TEST ONLY. Not valid real retailer consent.',
        }],
      })),
    },
    grant: {
      supermarket: retailer, kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true, robotsReviewed: true,
      noAntiBotBypass: true,
    },
  }
}
const product = (retailer, price = '2.45', declaredUrl = urlOf(retailer)) =>
  ({
    '@context': 'https://schema.org',
    '@type': 'Product',
    url: declaredUrl,
    name: 'FICTIONAL test-only milk',
    sku: 'FICTIONAL-MILK-001',
    weight: { '@type': 'QuantitativeValue', value: 500, unitCode: 'GRM' },
    offers: {
      '@type': 'Offer', price, priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
    },
  })
const html = retailer => '<html><head><script type="application/ld+json">' +
  JSON.stringify(product(retailer)) + '</script></head></html>'
const response = body => new Response(body, {
  status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
})

test('PLUS: explicit mocked authorized capture yields one private source-bound product review', async () => {
  const session = createAuthorizedRetailerProductPreviewSession()
  const markup = html('plus')
  let called = 0
  const result = await session.previewOne({
    ...request(),
    fetchFn: async (url, opts) => {
      called++
      assert.equal(url, urlOf('plus'))
      assert.equal(opts.redirect, 'error')
      assert.equal(opts.credentials, 'omit')
      return response(markup)
    },
  })
  assert.equal(called, 1)
  assert.equal(result.reviewStatus, 'product-needs-human-review')
  assert.equal(result.privateProductObservation.currentPriceCents, 245)
  assert.equal(result.privateProductObservation.pack.amount, 500)
  assert.equal(result.privateProductObservation.provenance.sha256,
    createHash('sha256').update(markup).digest('hex'))
  assert.equal(result.sha256, result.privateProductObservation.provenance.sha256)
  assert.equal(result.capturedAt, captureAt)
  assert.equal(result.privateOperatorOnly, true)
  assert.equal(result.htmlBodyIncluded, false)
  for (const flag of ['readyForIngestion', 'productionEnabled',
    'currentPriceVerified', 'currentAvailabilityVerified',
    'publicPricePublicationEnabled', 'publicSavingsClaimEligible',
    'productApprovedForIngestion']) {
    assert.equal(result[flag], false, flag)
  }
  assert.equal(session.status().stores.plus.verifiedCaptures, 1)
  assert.equal(session.status().stores.dekamarkt.verifiedCaptures, 0)
  assert.deepEqual(session.status().privateProductReviewCounts.plus, { accepted: 1, abstained: 0 })
  assert.deepEqual(session.status().privateProductReviewCounts.dekamarkt, { accepted: 0, abstained: 0 })
  assert.doesNotMatch(JSON.stringify(result), /<script/)
})

test('DekaMarkt: one true page-bound private observation, unrelated cheap recommendation excluded', async () => {
  const session = createAuthorizedRetailerProductPreviewSession()
  const markup = '<script type="application/ld+json">' +
    JSON.stringify({ '@graph': [
      product('dekamarkt', '0.01', 'https://www.dekamarkt.nl/producten/fictional-other'),
      product('dekamarkt', '1.79'),
    ] }) + '</script>'
  const result = await session.previewOne({
    ...request('dekamarkt'), fetchFn: async () => response(markup),
  })
  assert.equal(result.reviewStatus, 'product-needs-human-review')
  assert.equal(result.privateProductObservation.currentPriceCents, 179)
  assert.equal(result.privateProductObservation.supermarket, 'dekamarkt')
  assert.equal(result.currentPriceVerified, false)
  assert.equal(session.status().stores.dekamarkt.verifiedCaptures, 1)
  assert.deepEqual(session.status().privateProductReviewCounts.dekamarkt, { accepted: 1, abstained: 0 })
})

test('rights refusal consumes zero requests and prevents offline preview from bypassing M1', async () => {
  const session = createAuthorizedRetailerProductPreviewSession()
  const noRights = request()
  noRights.permissionGate.sources[0].permissionStatus = 'permission_required'
  noRights.permissionGate.sources[0].productionEnabled = false
  let called = 0
  await assert.rejects(session.previewOne({
    ...noRights, fetchFn: async () => { called++; return response(html('plus')) },
  }), /Explicit retailer source permission required/)
  assert.equal(called, 0)
  assert.equal(session.status().stores.plus.attemptedCaptures, 0)
  assert.deepEqual(session.status().privateProductReviewCounts.plus, { accepted: 0, abstained: 0 })
})

test('catalog/offers and poisoned caller getters refuse before any transport', async () => {
  const session = createAuthorizedRetailerProductPreviewSession()
  let called = 0, getters = 0
  const transport = async () => { called++; return response(html('plus')) }
  for (const kind of ['catalog', 'offers']) {
    await assert.rejects(session.previewOne({
      ...request(), source: { ...request().source, kind },
      fetchFn: transport,
    }), /Private authorized product preview refused/)
  }
  const poisoned = request()
  Object.defineProperty(poisoned.source, 'kind', {
    get() { getters++; return 'product' },
  })
  await assert.rejects(session.previewOne({
    ...poisoned, fetchFn: transport,
  }), /Private authorized product preview refused/)
  await assert.rejects(session.previewOne(new Proxy({
    ...request(), fetchFn: transport,
  }, {})), /Private authorized product preview refused/)
  assert.equal(called, 0)
  assert.equal(getters, 0)
})

test('mismatched JSON-LD Product stays private abstention, not a price guess', async () => {
  const session = createAuthorizedRetailerProductPreviewSession()
  const markup = '<script type="application/ld+json">' +
    JSON.stringify(product('plus', '0.01', 'https://www.plus.nl/product/fictional-other')) +
    '</script>'
  const result = await session.previewOne({
    ...request(), fetchFn: async () => response(markup),
  })
  assert.equal(result.reviewStatus, 'abstained')
  assert.equal(result.privateProductObservation, null)
  assert.equal(result.readyForIngestion, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(session.status().stores.plus.verifiedCaptures, 1)
  assert.deepEqual(session.status().privateProductReviewCounts.plus, { accepted: 0, abstained: 1 })
  assert.doesNotMatch(JSON.stringify(result), /0\.01|fictional-other/)
})

test('HTTP 429 hard-stops host; no implicit network, retries or public reports', async () => {
  const session = createAuthorizedRetailerProductPreviewSession()
  let called = 0
  const transport = async () => {
    called++
    return new Response('', { status: 429 })
  }
  await assert.rejects(session.previewOne({
    ...request(), fetchFn: transport,
  }), /Retailer refused or rate-limited/)
  assert.equal(session.status().stores.plus.hardStopped, true)
  await assert.rejects(session.previewOne({
    ...request(), fetchFn: transport,
  }), /Retailer capture session refused/)
  assert.equal(called, 1)
  assert.equal(session.status().scheduledCaptureEnabled, false)
  assert.equal(session.status().proxyRotationEnabled, false)
})

test('product review metrics do not disclose HTML, URLs, names or price records', async () => {
  const session = createAuthorizedRetailerProductPreviewSession()
  const accepted = await session.previewOne({
    ...request(), fetchFn: async () => response(html('plus')),
  })
  assert.equal(accepted.reviewStatus, 'product-needs-human-review')
  const summary = session.status()
  assert.deepEqual(summary.privateProductReviewCounts.plus, { accepted: 1, abstained: 0 })
  assert.deepEqual(summary.privateProductReviewCounts.dekamarkt, { accepted: 0, abstained: 0 })
  assert.doesNotMatch(JSON.stringify(summary), /fictional-milk|FICTIONAL-MILK|www[.]plus|currentPriceCents|<script|2[.]45/)
})
