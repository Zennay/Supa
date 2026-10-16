import test from 'node:test'
import assert from 'node:assert/strict'
import { dekamarkt, dirk } from '../scraper/adapters/detailresult.mjs'

// Fully fictional in-memory pages. This exercises the legacy JSON-LD
// fallback when Nuxt is absent, not retailer HTTP, scraping or rights.
function html(product, another) {
  return [product, another].filter(Boolean)
    .map(value => '<script type="application/ld+json">' +
      JSON.stringify(value) + '</script>').join('')
}
function product(overrides = {}) {
  return {
    '@type': 'Product',
    name: 'Fictional pantry article',
    mpn: '12345',
    offers: {
      '@type': 'Offer', priceCurrency: 'EUR', price: '2.49',
      availability: 'https://schema.org/InStock',
    },
    ...overrides,
  }
}

for (const adapter of [dekamarkt, dirk]) {
  const source = 'https://' + adapter.host + '/producten/synthetic/12345'
  test(adapter.id + ': matched fallback mpn and source URL admit only matching private article', () => {
    const rows = adapter.parse(html(product({ url: source })), source)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].sourceId, '12345')
    assert.equal(rows[0].priceCents, 249)
    assert.equal(rows[0].url, source)
  })
  test(adapter.id + ': matching explicit mpn remains accepted without Product.url', () => {
    const rows = adapter.parse(html(product()), source)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].sourceId, '12345')
  })
  test(adapter.id + ': matching exact Product.url is valid identity when mpn is missing', () => {
    const rows = adapter.parse(html(product({ mpn: undefined, url: source })), source)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].sourceId, '12345')
  })
  for (const [label, overrides] of [
    ['foreign product ID with matching URL', { mpn: '99999', url: source }],
    ['foreign article path with same numeric ID', {
      url: 'https://' + adapter.host + '/producten/different/12345',
    }],
    ['foreign host with same path', {
      url: 'https://outside.example.test/producten/synthetic/12345',
    }],
    ['lookalike sibling product URL', {
      url: source.replace('/12345', '/23456'),
    }],
    ['unattributed JSON-LD product', { mpn: undefined }],
  ]) {
    test(adapter.id + ': refuse fallback ' + label, () => {
      assert.deepEqual(adapter.parse(html(product(overrides)), source), [])
    })
  }
  test(adapter.id + ': missing article ID cannot authorize fallback', () => {
    assert.deepEqual(
      adapter.parse(html(product({ url: source })), 
        'https://' + adapter.host + '/producten/synthetic/no-id'),
      [],
    )
  })
  test(adapter.id + ': multi-Product JSON-LD must not choose first', () => {
    assert.deepEqual(adapter.parse(html(product({url: source}), product({
      mpn: '99999', url: 'https://' + adapter.host + '/producten/other/99999',
    })), source), [])
  })
}
