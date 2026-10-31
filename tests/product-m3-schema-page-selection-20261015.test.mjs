import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSchemaOrgProductForPage } from '../src/data/schemaOrgProductPageSelection.ts'
import { parseSchemaOrgProduct } from '../src/data/schemaOrgProduct.ts'

// All examples are fictional and purely local: no retailer network, product
// observations, permissions, saved-money claims or personal information.
const plus = {
  supermarket: 'plus',
  kind: 'product',
  url: 'https://www.plus.nl/product/fictional-chicken',
  capturedAt: '2026-10-14T12:00:00Z',
  sha256: 'a'.repeat(64),
}
const deka = {
  ...plus,
  supermarket: 'dekamarkt',
  url: 'https://www.dekamarkt.nl/producten/fictional-chicken',
}

function product(url = plus.url, price = '1.29') {
  return {
    '@type': 'Product',
    url,
    name: 'Fictieve kippendij',
    sku: 'FICTIONAL-123',
    weight: { value: '500 g' },
    offers: {
      '@type': 'Offer',
      price,
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
    },
  }
}

test('exact URL selects one target Product from a multi-Product recommendation graph', () => {
  const foreign = product('https://www.plus.nl/product/another-fictional-product', '99.99')
  const graph = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', name: 'Fictional catalogue page' },
    foreign,
    product(),
  ] }
  const result = parseSchemaOrgProductForPage(graph, plus)
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, 129)
  assert.equal(result.observation.name, 'Fictieve kippendij')
  assert.equal(result.observation.pack.amount, 500)
  assert.equal(result.observation.pack.unit, 'g')
  assert.equal(result.observation.availability, 'available')
  assert.deepEqual(result.observation.provenance, plus)
})

test('Product arrays and @type arrays select the same provenance-bound DekaMarkt node', () => {
  const graph = [
    { ...product('https://www.dekamarkt.nl/producten/another-fake', '55.00'), '@type': ['WebPage', 'Product'] },
    { '@graph': [product(deka.url, '2.00')] },
  ]
  const result = parseSchemaOrgProductForPage(graph, deka)
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, 200)
  assert.equal(result.observation.supermarket, 'dekamarkt')
})

test('a single Product without URL keeps the legacy conservative parser path', () => {
  const { url, ...withoutUrl } = product()
  const oldResult = parseSchemaOrgProduct(withoutUrl, plus)
  const newResult = parseSchemaOrgProductForPage(withoutUrl, plus)
  assert.deepEqual(newResult, oldResult)
})

test('one Product with a contradictory URL cannot overwrite its captured origin', () => {
  const result = parseSchemaOrgProductForPage(
    product('https://www.plus.nl/product/other'), plus)
  assert.equal(result.type, 'abstain')
  assert.match(result.reason, /disagrees/)
})

test('multi-Product graph without a product matching the captured URL abstains', () => {
  const graph = [product('https://www.plus.nl/product/one'),
    product('https://www.plus.nl/product/two')]
  const result = parseSchemaOrgProductForPage(graph, plus)
  assert.equal(result.type, 'abstain')
  assert.match(result.reason, /no unambiguous/)
})

test('multiple Products with the same declared page URL abstain, never take cheapest', () => {
  const result = parseSchemaOrgProductForPage([product(), product(plus.url, '0.01')], plus)
  assert.equal(result.type, 'abstain')
  assert.match(result.reason, /distinct/)
})

test('URL-less recommendation in graph cannot be silently ignored', () => {
  const { url, ...recommended } = product('https://www.plus.nl/product/another')
  const result = parseSchemaOrgProductForPage([product(), recommended], plus)
  assert.equal(result.type, 'abstain')
  assert.match(result.reason, /distinct/)
})

test('unsafe product URLs and mismatched provenance are refused before pricing', () => {
  for (const badUrl of [
    'http://www.plus.nl/product/fictional-chicken',
    'https://plus.nl@evil.invalid/product/fictional-chicken',
    plus.url + '#fragment',
    'https://www.plus.nl:443/product/fictional-chicken',
    '',
    ['https://www.plus.nl/product/fictional-chicken'],
  ]) {
    assert.equal(parseSchemaOrgProductForPage(
      [product(), product(badUrl)], plus).type, 'abstain')
  }
  assert.equal(parseSchemaOrgProductForPage(product(), {
    ...plus, url: 'https://attacker.invalid/product/fictional-chicken',
  }).type, 'abstain')
})

test('existing parser still enforces EUR, stock and physically observed pack', () => {
  const wrongCurrency = product()
  wrongCurrency.offers.priceCurrency = 'USD'
  const result = parseSchemaOrgProductForPage([wrongCurrency, product(
    'https://www.plus.nl/product/other',
  )], plus)
  assert.equal(result.type, 'abstain')
  assert.match(result.reason, /not verified/)
})

test('missing Product JSON-LD abstains without inventing price', () => {
  assert.equal(parseSchemaOrgProductForPage(
    { '@graph': [{ '@type': 'WebPage', name: 'no product' }] },
    plus,
  ).type, 'abstain')
})

test('bounded graph refuses cyclic, oversized and sparse untrusted arrays', () => {
  const cycle = { '@type': 'WebPage' }
  cycle['@graph'] = [cycle]
  const large = Array.from({ length: 129 }, () => ({ '@type': 'WebPage' }))
  const sparse = new Array(3)
  sparse[1] = product()
  for (const value of [cycle, large, sparse]) {
    assert.equal(parseSchemaOrgProductForPage(value, plus).type, 'abstain')
  }
})

test('revoked Proxy and hostile accessor fail closed without leaking error messages', () => {
  const { proxy, revoke } = Proxy.revocable(product(), {})
  revoke()
  const accessor = { '@graph': [product()] }
  Object.defineProperty(accessor, '@type', {
    get() { throw new Error('PRIVATE_EXFILTRATE_ME') },
  })
  for (const value of [proxy, accessor]) {
    const result = parseSchemaOrgProductForPage(value, plus)
    assert.equal(result.type, 'abstain')
    assert.doesNotMatch(result.reason, /PRIVATE_EXFILTRATE_ME/)
  }
})


test('only an actual retailer product-page source may select a priced Product', () => {
  for (const badSource of [
    { ...plus, kind: 'catalog' },
    { ...plus, url: 'https://www.plus.nl/aanbiedingen' },
    { ...plus, url: 'https://www.plus.nl/product/' },
    { ...plus, supermarket: 'dekamarkt' },
    { ...plus, supermarket: 'unrecognized' },
  ]) {
    const result = parseSchemaOrgProductForPage(product(), badSource)
    assert.equal(result.type, 'abstain')
    assert.equal(result.reason, 'invalid captured product-page URL')
  }
})

test('hostile retailer currency never leaks from the legacy parser diagnosis', () => {
  const poisoned = product()
  poisoned.offers.priceCurrency = 'PRIVATE_CURRENCY_CONTACT_555'
  const result = parseSchemaOrgProductForPage(poisoned, plus)
  assert.equal(result.type, 'abstain')
  assert.equal(result.reason, 'selected Product price, currency or provenance not verified')
  assert.doesNotMatch(result.reason, /PRIVATE_CURRENCY_CONTACT_555/)
})

test('standalone captured-product parser follows M1 exact offline product-source route admission', () => {
  const other = { ...plus, supermarket: 'dekamarkt',
    url: 'https://www.dekamarkt.nl/producten/fictional' }
  const unsafe = [
    '/product/fictional?session=synthetic',
    '/product/fictional#review',
    '/product/x%2fcheckout',
    '/product/x%5ccheckout',
    '/product/x%252fcheckout',
    '/product/x%2ehidden',
    '/product//admin',
    '/product/fictional%00admin',
    '/product/fictional%7fadmin',
    '/product/',
  ]
  for (const path of unsafe) {
    const src = { ...plus, url: 'https://www.plus.nl' + path }
    const candidate = product(src.url)
    const one = parseSchemaOrgProductForPage(candidate, src)
    assert.equal(one.type, 'abstain', 'PLUS source ' + path)
    assert.equal(one.reason, 'invalid captured product-page URL')
  }
  for (const path of ['/producten/x%2fcheckout', '/producten/x%252fcheckout',
                      '/producten//admin', '/producten/fictional?view=synthetic']) {
    const src = { ...other, url: 'https://www.dekamarkt.nl' + path }
    assert.equal(parseSchemaOrgProductForPage(product(src.url), src).type,
      'abstain', 'Deka source ' + path)
  }
  // Legitimate synthetic product URLs must remain usable for offline review.
  assert.equal(parseSchemaOrgProductForPage(product(plus.url), plus).type,'observation')
  assert.equal(parseSchemaOrgProductForPage(product(other.url), other).type,'observation')
})
