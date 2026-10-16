import test from 'node:test'
import assert from 'node:assert/strict'
import { schemaOrgPrices, recordFromSchemaOrg } from '../scraper/adapters/schemaorg.mjs'
import { parsePlus } from '../scraper/adapters/plus.mjs'
import { dekamarkt } from '../scraper/adapters/detailresult.mjs'

// Independent offline M3 price integrity. The full-basket comparator stores
// whole EURO cents; a document's explicit foreign currency cannot authorize
// that number even if its decimal syntax looks identical to EUR.
//
// All products, values and URLs are invented. Parsing only: no fetching,
// retailer authorization, live pricing, database or production mutation.
const price = (amount, currency) => ({ '@type': 'Offer', price: amount, priceCurrency: currency })
const noPrice = (p) => {
  assert.equal(p.priceCents, null)
  assert.equal(p.promoPriceCents, null)
}

test('ordinary explicitly-EUR checkout price and legacy unspecified currency stay readable', () => {
  assert.deepEqual(schemaOrgPrices(price('2.99', 'EUR')), { priceCents: 299, promoPriceCents: null })
  assert.deepEqual(schemaOrgPrices({ '@type': 'Offer', price: '2.99' }), { priceCents: 299, promoPriceCents: null })
})

for (const foreign of ['USD', 'GBP']) {
  test(`explicit ${foreign} checkout price is not silently represented as EUR cents`, () => {
    noPrice(schemaOrgPrices(price('2.99', foreign)))
  })
}

test('a cheap foreign-currency Offer cannot undercut an actual EUR Offer', () => {
  const result = schemaOrgPrices([
    price('2.99', 'EUR'),
    price('0.99', 'USD'),
  ])
  assert.deepEqual(result, { priceCents: 299, promoPriceCents: null })
})

test('foreign currency PriceSpecification cannot create a fictional EUR sale', () => {
  const result = schemaOrgPrices({
    ...price('2.99', 'EUR'),
    priceSpecification: {
      '@type': 'PriceSpecification',
      price: '0.99',
      priceCurrency: 'USD',
    },
  })
  assert.deepEqual(result, { priceCents: 299, promoPriceCents: null })
})

test('generic parsed product preserves identity but not explicitly foreign checkout price', () => {
  const rec = recordFromSchemaOrg({
    '@type': 'Product',
    sku: 'synthetic-sku',
    name: 'Invented pantry item',
    offers: price('4.49', 'USD'),
  }, { retailer: 'fictional', url: 'https://example.test/fictional' })
  assert.equal(rec.sourceId, 'synthetic-sku')
  assert.equal(rec.priceCents, null)
})

test('PLUS rendered Product JSON-LD must not produce EUR price from explicit foreign currency', () => {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Synthetic oats',
    sku: '12345',
    offers: price('3.49', 'USD'),
  }) + '</script>'
  const rows = parsePlus(html, 'https://www.plus.nl/producten/oats-12345')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].priceCents, null)
})

test('DekaMarkt JSON-LD fallback must not mint EUR checkout amount from GBP', () => {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Synthetic cereal',
    mpn: '12345',
    offers: price('2.49', 'GBP'),
  }) + '</script>'
  const rows = dekamarkt.parse(html, 'https://www.dekamarkt.nl/producten/synthetic/12345')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].priceCents, null)
})
