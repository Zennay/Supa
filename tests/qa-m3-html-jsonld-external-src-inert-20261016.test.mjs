import assert from 'node:assert/strict'
import test from 'node:test'
import { parseM3OfflineProductHtml } from
  '../scripts/m3-offline-html-product.mjs'

// All HTML and Product facts in this QA file are fictional, offline, and
// *never* evidence of retailer permission, actual price, or live ingestion.
const url = 'https://www.plus.nl/product/fictional-inline-script-only-840'
const capturedAt = '2026-10-14T12:00:00Z'
const product = {
  '@context': 'https://schema.org', '@type': 'Product',
  url, sku: 'fictional-840', name: 'Entirely fictional packaged food',
  weight: { '@type': 'QuantitativeValue', value: 500, unitCode: 'GRM' },
  offers: { '@type': 'Offer', price: '1.29', priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock' },
}
const json = JSON.stringify(product)
function parse(attrs) {
  return parseM3OfflineProductHtml({
    source: { supermarket: 'plus', kind: 'product', url },
    capturedAt,
    html: '<!doctype html><html><head><script ' + attrs + '>' +
      json + '</script></head><body>synthetic local QA</body></html>',
  })
}

test('ordinary INLINE JSON-LD with exact type yields only offline unverified preview', () => {
  const result = parse('type="application/ld+json"')
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, 129)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.evidenceStatus, 'offline-preview-not-retailer-verification')
})

test('data-src is not an authoritative external script source and legitimate INLINE JSON-LD survives', () => {
  const result = parse('type="application/ld+json" data-src="fake"')
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, 129)
  assert.equal(result.publicSavingsClaimEligible, false)
})

for (const [label, attrs] of [
  ['external src with URL', 'type="application/ld+json" src="https://untrusted.example.test/possibly-price.js"'],
  ['uppercase SRC with URL', 'TYPE="application/ld+json" SRC="https://untrusted.example.test/possibly-price.js"'],
  ['bare src without value', 'type="application/ld+json" src'],
]) {
  test('offline price must refuse non-inline JSON-LD data block: ' + label, () => {
    const result = parse(attrs)
    // A data-block script's "src" attribute is not an independently
    // reviewed inline JSON-LD source. Even perfectly consistent fictional
    // SHA and valid inside bytes cannot certify a price from this tag.
    assert.equal(result.type, 'abstain')
    assert.equal(Object.hasOwn(result, 'observation'), false)
    assert.equal(result.publicSavingsClaimEligible, false)
  })
}
