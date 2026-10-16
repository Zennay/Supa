import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRecord, normalizeGtin } from '../scraper/lib/normalize.mjs'

// Independent offline QA: a product URL, SKU prose or arbitrary text is not
// a trusted barcode. A checksum-valid run of digits embedded in text remains
// unverified as GTIN; discarding the surrounding letters silently would
// promote unverified product identity into the cross-retailer match graph.
//
// All examples are synthetic and never call network, databases or retailers.
const VALID_GTIN_13 = '4006381333931'

test('genuine primitive EAN remains normalizable in harmless spaced/hyphenated notation', () => {
  assert.equal(normalizeGtin(VALID_GTIN_13), VALID_GTIN_13)
  assert.equal(normalizeGtin(4006381333931), VALID_GTIN_13)
  assert.equal(normalizeGtin('4006 3813 3393 1'), VALID_GTIN_13)
  assert.equal(normalizeGtin('4006-3813-3393-1'), VALID_GTIN_13)
  assert.equal(normalizeGtin('4006381333932'), null, 'wrong checksum must abstain')
})

for (const [label, supplied] of [
  ['arbitrary text prefix', 'product-' + VALID_GTIN_13],
  ['free-form GTIN label', 'barcode:' + VALID_GTIN_13],
  ['article URL path', 'https://retailer.invalid/item/' + VALID_GTIN_13],
  ['embedded suffix', VALID_GTIN_13 + 'abc'],
  ['malformed mixed punctuation', 'item/' + VALID_GTIN_13 + '?variant=red'],
]) {
  test(`untrusted ${label} must not be stripped into a verified barcode`, () => {
    assert.equal(normalizeGtin(supplied), null)
  })
}

test('making a product record never converts an arbitrary URL-like barcode into product identity', () => {
  const item = makeRecord({
    retailer: 'fictional-retailer',
    sourceId: 'fictional-sku',
    name: 'Fictional oatmeal',
    gtin: 'https://retailer.invalid/p/' + VALID_GTIN_13,
    packText: '500 g',
    priceCents: 230,
    availability: 'unknown',
  })
  assert.equal(item.gtin, null)
  assert.equal(item.retailer, 'fictional-retailer')
  assert.equal(item.priceCents, 230)
})
