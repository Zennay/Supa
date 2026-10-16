import test from 'node:test'
import assert from 'node:assert/strict'
import { dekamarkt, dirk } from '../scraper/adapters/detailresult.mjs'

// Independent QA for the NEW Nuxt3/devalue scraper adapter rather than the
// legacy M1 SSR module tracked in issue #539. A stored priced record must
// match the terminal numeric source product route. Never select candidates[0]
// to mint a different product identity for a caller URL.
//
// This is entirely synthetic, in-process JSON; no real retailer HTTP or DB.
function productHtml(productId) {
  const table = [
    { data: 1 },
    { 'product-information-fixture': 2 },
    { productId: 3, productAssortment: 4, headerText: 5, packaging: 6 },
    productId,
    { normalPrice: 7 },
    'Fictional grocery product',
    '500 g',
    '2.49',
  ]
  return '<!doctype html><script id="__NUXT_DATA__" type="application/json">' +
    JSON.stringify(table) + '</script>'
}

for (const adapter of [dekamarkt, dirk]) {
  const url = 'https://' + adapter.host + '/producten/synthetic/12345'
  test(adapter.id + ': valid matching numeric route and Nuxt productId remains accepted', () => {
    const rows = adapter.parse(productHtml(12345), url)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].sourceId, '12345')
    assert.equal(rows[0].priceCents, 249)
    assert.equal(rows[0].retailer, adapter.id)
  })

  test(adapter.id + ': foreign Nuxt productId cannot mint a price for a different article route', () => {
    const rows = adapter.parse(productHtml(98765), url)
    assert.deepEqual(rows, [], 'must not fall back to first candidate when URL id differs')
  })

  test(adapter.id + ': no terminal numeric source id must mean no priced Nuxt record', () => {
    const rows = adapter.parse(productHtml(12345),
      'https://' + adapter.host + '/producten/synthetic/no-canonical-id')
    assert.deepEqual(rows, [], 'route must expose a verifiable source article identity')
  })
}
