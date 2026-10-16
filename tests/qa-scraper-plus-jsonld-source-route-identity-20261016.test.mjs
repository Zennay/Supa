import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePlus } from '../scraper/adapters/plus.mjs'

// New universal retail scraper's PLUS adapter. This is separate from the
// legacy rendered evidence parser protected by old issues #537/#729.
// Neither a missing numeric source ID nor a contradictory Product.url can
// authorize a current price under an unrelated observed page source.
// Synthetic JSON-LD only, absolutely no retailer network or capture rights.
const SOURCE = 'https://www.plus.nl/producten/fictional-oats-12345'

function page({ sku = '12345', url } = {}) {
  const product = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Fictional breakfast oats',
    sku,
    offers: { '@type': 'Offer', price: '2.29', priceCurrency: 'EUR' },
  }
  if (url !== undefined) product.url = url
  return '<!doctype html><script type="application/ld+json">' +
    JSON.stringify(product) + '</script>'
}

test('valid source SKU and identical Product.url remain a known product', () => {
  const recs = parsePlus(page({ url: SOURCE }), SOURCE)
  assert.equal(recs.length, 1)
  assert.equal(recs[0].sourceId, '12345')
  assert.equal(recs[0].priceCents, 229)
})

test('valid source SKU with no declared Product.url remains compatible', () => {
  const recs = parsePlus(page(), SOURCE)
  assert.equal(recs.length, 1)
  assert.equal(recs[0].sourceId, '12345')
})

test('different rendered SKU cannot be stored as the source product', () => {
  assert.deepEqual(parsePlus(page({ sku: '98765' }), SOURCE), [])
})

for (const [label, url] of [
  ['different article ID', 'https://www.plus.nl/producten/fictional-oats-98765'],
  ['different path with same ID', 'https://www.plus.nl/producten/different-12345'],
  ['foreign host', 'https://foreign.example.test/producten/fictional-oats-12345'],
]) {
  test('declared Product.url with ' + label + ' cannot contradict observed article source', () => {
    assert.deepEqual(parsePlus(page({ url }), SOURCE), [])
  })
}

test('PLUS rendered page without numeric terminal SKU in observed article route is not price evidence', () => {
  const rows = parsePlus(page(), 'https://www.plus.nl/producten/fictional-oats')
  assert.deepEqual(rows, [], 'do not accept first JSON-LD Product when URL cannot verify numeric ID')
})
