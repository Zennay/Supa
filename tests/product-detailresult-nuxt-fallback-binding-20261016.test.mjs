import test from 'node:test'
import assert from 'node:assert/strict'

import { dekamarkt, dirk } from '../scraper/adapters/detailresult.mjs'

// Fictional in-memory Nuxt + JSON-LD. Wrong Nuxt page metadata must not
// use a fallback to launder prices under a requested article's real URL.
function conflictingHtml() {
  const table = [
    { data: 1 },
    { 'product-information-unrelated': 2 },
    { productId: 3, productAssortment: 4, headerText: 5 },
    98765,
    { normalPrice: 6 },
    'Other fictional grocery item',
    '0.99',
  ]
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    mpn: '12345',
    name: 'Synthetic fallback',
    offers: { price: '2.99', priceCurrency: 'EUR' },
  }
  return '<script id="__NUXT_DATA__" type="application/json">' +
    JSON.stringify(table) + '</script><script type="application/ld+json">' +
    JSON.stringify(ld) + '</script>'
}

for (const adapter of [dekamarkt, dirk]) {
  test(adapter.id + ': contradictory Nuxt article cannot masquerade as correct JSON-LD fallback', () => {
    const url = 'https://' + adapter.host + '/producten/fictional/12345'
    assert.deepEqual(adapter.parse(conflictingHtml(), url), [])
  })
}
