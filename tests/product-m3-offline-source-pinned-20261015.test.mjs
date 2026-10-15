import test from 'node:test'
import assert from 'node:assert/strict'
import { parseM3OfflineProductHtml } from '../scripts/m3-offline-html-product.mjs'

const PLUS = {
  kind: 'product',
  supermarket: 'plus',
  url: 'https://www.plus.nl/product/fictional-apples',
}
const DEKA = {
  kind: 'product',
  supermarket: 'dekamarkt',
  url: 'https://www.dekamarkt.nl/producten/fictional-apples',
}
const TIME = '2026-10-14T12:00:00Z'
function html(url) {
  return '<script type="application/ld+json">' + JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    url,
    name: 'Fictional apples',
    sku: 'FICTIONAL-APPLES-123',
    weight: { '@type': 'QuantitativeValue', value: 500, unitCode: 'GRM' },
    offers: {
      '@type': 'Offer', price: '2.49', priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
    },
  }) + '</script>'
}
function parse(source, page = html(DEKA.url)) {
  return parseM3OfflineProductHtml({ source, html: page, capturedAt: TIME })
}
function refuses(result) {
  assert.equal(result.type, 'abstain')
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.doesNotMatch(JSON.stringify(result), /FICTIONAL-APPLES-123/)
}

test('M3 pinned own source permits normal private PLUS and Deka product pages', () => {
  for (const source of [PLUS, DEKA]) {
    const result = parse({ ...source }, html(source.url))
    assert.equal(result.type, 'observation')
    assert.equal(result.provenance.supermarket, source.supermarket)
    assert.equal(result.provenance.url, source.url)
    assert.equal(result.observation.currentPriceCents, 249)
    assert.equal(result.publicSavingsClaimEligible, false)
  }
})

test('M3 refuses accessor source identity before any accessor can switch stores', () => {
  const hostile = { kind: 'product', supermarket: 'plus', url: PLUS.url }
  let calls = 0
  Object.defineProperty(hostile, 'supermarket', {
    enumerable: true,
    get() { calls += 1; return calls === 1 ? 'plus' : 'dekamarkt' },
  })
  refuses(parse(hostile))
  assert.equal(calls, 0)
})

test('M3 refuses inherited source identities even with apparent valid store and URL', () => {
  const inherited = Object.create(DEKA)
  inherited.kind = 'product'
  refuses(parse(inherited))
  const nullPrototype = Object.assign(Object.create(null), DEKA)
  refuses(parse(nullPrototype))
})

test('M3 refuses dynamic Proxy identity without triggering get or ownKeys traps', () => {
  let calls = 0
  const proxy = new Proxy({ ...DEKA }, {
    get(target, key, receiver) { calls += 1; return Reflect.get(target, key, receiver) },
    ownKeys(target) { calls += 1; return Reflect.ownKeys(target) },
  })
  refuses(parse(proxy))
  assert.equal(calls, 0)
})

test('M3 refuses hidden, symbol or additional source fields rather than guessing', () => {
  const hidden = { ...DEKA }
  Object.defineProperty(hidden, 'unreviewed', { value: true })
  refuses(parse(hidden))
  refuses(parse({ ...DEKA, extra: 'untrusted' }))
  refuses(parse({ ...DEKA, [Symbol('secret')]: true }))
})

test('M3 source descriptor validation refuses own non-enumerable and wrong-type fields', () => {
  const nonEnumerable = { ...DEKA }
  Object.defineProperty(nonEnumerable, 'url', { value: DEKA.url, enumerable: false })
  refuses(parse(nonEnumerable))
  refuses(parse({ ...DEKA, url: { toString: () => DEKA.url } }))
  refuses(parse({ ...DEKA, kind: new String('product') }))
})
