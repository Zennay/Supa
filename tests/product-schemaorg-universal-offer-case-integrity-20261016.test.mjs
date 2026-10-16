import test from 'node:test'
import assert from 'node:assert/strict'
import { schemaOrgPrices } from '../scraper/adapters/schemaorg.mjs'
import { parsePlus } from '../scraper/adapters/plus.mjs'
import { dekamarkt, dirk } from '../scraper/adapters/detailresult.mjs'

// Every offer, URL and price below is invented. No HTTP, actual supermarket
// grant, real checkout price, database write or public savings assertion.
for (const [label, offer, expected] of [
  ['plain EUR price', { price: '0.85', priceCurrency: 'EUR' }, 85],
  ['historical uppercase Price alone', { Price: 0.85, priceCurrency: 'EUR' }, 85],
  ['two agreeing price spellings', {
    price: '0.85', Price: 0.85, priceCurrency: 'EUR',
  }, 85],
  ['lowercase and uppercase prices disagree', {
    price: '0.85', Price: 0.84, priceCurrency: 'EUR',
  }, null],
  ['all-caps and lowercase prices disagree', {
    price: '0.85', PRICE: 0.86, priceCurrency: 'EUR',
  }, null],
  ['invalid second price', {
    price: '0.85', Price: 'one euro', priceCurrency: 'EUR',
  }, null],
  ['EUR and USD explicit currencies conflict', {
    price: '0.85', priceCurrency: 'EUR', PriceCurrency: 'USD',
  }, null],
  ['equivalent currency spellings', {
    price: '0.85', priceCurrency: 'EUR', PriceCurrency: 'eur',
  }, 85],
  ['different lowPrice spellings', {
    lowPrice: '0.85', LOWPRICE: '0.84', priceCurrency: 'EUR',
  }, null],
  ['nested price specification conflict', {
    priceCurrency: 'EUR',
    priceSpecification: { price: '0.85', Price: '0.84' },
  }, null],
]) {
  test('universal Schema.org Offer case provenance: ' + label, () => {
    const result = schemaOrgPrices(offer)
    assert.equal(result.priceCents, expected)
  })
}

test('one conflicting offer rejects all prices, not only that offer', () => {
  const result = schemaOrgPrices([
    { price: '0.85', priceCurrency: 'EUR' },
    { price: '0.80', Price: '0.90', priceCurrency: 'EUR' },
  ])
  assert.equal(result.priceCents, null)
  assert.equal(result.promoPriceCents, null)
})
test('PLUS universal adapter never emits priced record from contradictory Offer keys', () => {
  const source = 'https://www.plus.nl/product/fictional-pantry-12345'
  const ld = { '@type': 'Product', sku: '12345', url: source,
    name: 'Fictional pasta', weight: { value: '500 g' },
    offers: { price: '0.85', Price: '0.84', priceCurrency: 'EUR' } }
  const html = '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>'
  const rows = parsePlus(html, source)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].priceCents, null)
})
for (const adapter of [dekamarkt, dirk]) {
  test(adapter.id + ' JSON-LD fallback keeps conflicting prices unverified', () => {
    const source = 'https://' + adapter.host + '/producten/fictional/12345'
    const ld = { '@type': 'Product', mpn: '12345', url: source,
      name: 'Fictional cupboard item',
      offers: { price: '2.49', Price: '2.39', priceCurrency: 'EUR' } }
    const html = '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>'
    const rows = adapter.parse(html, source)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].priceCents, null)
  })
}
