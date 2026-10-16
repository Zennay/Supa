import test from 'node:test'
import assert from 'node:assert/strict'
import { captureApprovedProductPriceCandidate } from '../scripts/retailer-approved-html-product-price-candidate.mjs'

// All evidence is synthetic and injected: no source permission, DNS, HTTP,
// real customer price or savings publication.
const url = 'https://www.plus.nl/product/fake-submillisecond-price-clock'
const permissionGate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven',
    permissionStatus: 'permitted', productionEnabled: true,
    evidence: [{
      kind: 'written_permission', url: 'https://example.test/no-actual-permission',
      finding: 'Fictional only — do not use as a real licence',
    }],
  })),
}
// A millisecond-precision source-capture clock establishes the exact edge;
// a retailer timestamp 1 ns later must not become active a whole ms early.
const afterCapturedNs = (iso, nanos = '000001') =>
  iso.replace(/(\.\d{3})Z$/, '$1' + nanos + 'Z')
const beforeCapturedNs = iso =>
  new Date(Date.parse(iso) - 1).toISOString()
    .replace(/(\.\d{3})Z$/, '$1' + '999999Z')
function withOffset(iso, hours = 2) {
  const civil = new Date(Date.parse(iso) + hours * 3600_000).toISOString()
  return civil.slice(0, -1) + (hours >= 0 ? '+' : '-') +
    String(Math.abs(hours)).padStart(2, '0') + ':00'
}
async function proposed(build) {
  const capturedAt = new Date(Date.now() - 30_000).toISOString()
  const offerFields = build(capturedAt)
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@type': 'Product', url, sku: 'FAKE-PRICE-NANO',
    name: 'Synthetic flour 500g', weight: { value: '500 g' },
    offers: {
      '@type': 'Offer', price: '1.49', priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock', ...offerFields,
    },
  }) + '</script>'
  const result = await captureApprovedProductPriceCandidate({
    source: { supermarket: 'plus', kind: 'product', url },
    permissionGate,
    grant: { supermarket: 'plus', kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true, robotsReviewed: true,
      noAntiBotBypass: true },
    capturedAt,
    fetchFn: async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  })
  assert.equal(result.productionEnabled, false)
  assert.equal(result.published, false)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.humanReviewRequired, true)
  return result
}
for (const [label, make] of [
  ['outer future start +1 nanosecond', at => ({
    validFrom: afterCapturedNs(at),
  })],
  ['outer future start +999999 nanoseconds', at => ({
    validFrom: afterCapturedNs(at, '999999'),
  })],
  ['outer future start +1 microsecond', at => ({
    validFrom: afterCapturedNs(at, '001000'),
  })],
  ['nested future start +1 nanosecond', at => ({
    priceSpecification: {
      '@type': 'UnitPriceSpecification', price: '1.49',
      priceCurrency: 'EUR', validFrom: afterCapturedNs(at),
    },
  })],
  ['offset source future start +1 nanosecond', at => ({
    validFrom: withOffset(at).replace(/(\.\d{3})\+02:00$/, '$1' + '000001+02:00'),
  })],
  ['past price expiry -1 nanosecond', at => ({
    priceValidUntil: beforeCapturedNs(at),
  })],
  ['nested past through -1 nanosecond', at => ({
    priceSpecification: {
      '@type': 'UnitPriceSpecification', price: '1.49',
      priceCurrency: 'EUR', validThrough: beforeCapturedNs(at),
    },
  })],
]) {
  test('nanosecond Offer boundary abstains: ' + label, async () => {
    const x = await proposed(make)
    assert.equal(x.status, 'review_required')
    assert.equal(x.observation, null)
  })
}
for (const [label, make] of [
  ['start exactly at captured instant', at => ({ validFrom: at })],
  ['start one nanosecond before capture', at => ({
    validFrom: beforeCapturedNs(at),
  })],
  ['price expiry safely after capture and review', at => ({
    priceValidUntil: new Date(Date.parse(at) + 60_000).toISOString(),
  })],
  ['price expiry with one extra nanosecond after review', at => ({
    priceValidUntil: afterCapturedNs(new Date(Date.parse(at) + 60_000).toISOString()),
  })],
  ['nested early start and late expiry', at => ({
    priceSpecification: {
      '@type': 'UnitPriceSpecification', price: '1.49',
      priceCurrency: 'EUR',
      validFrom: beforeCapturedNs(at),
      validThrough: afterCapturedNs(new Date(Date.parse(at) + 60_000).toISOString()),
    },
  })],
  ['normal fractional UTC offset at capture', at => ({
    validFrom: withOffset(at),
  })],
]) {
  test('nanosecond Offer boundary retains private review: ' + label, async () => {
    const x = await proposed(make)
    assert.equal(x.status, 'candidate_needs_review')
    assert.equal(x.observation?.currentPriceCents, 149)
  })
}
