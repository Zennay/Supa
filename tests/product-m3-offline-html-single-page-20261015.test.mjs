import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { parseM3OfflineProductHtml } from '../scripts/m3-offline-html-product.mjs'

const PLUS = {
  supermarket: 'plus',
  kind: 'product',
  url: 'https://www.plus.nl/product/fictional-kippendij',
}
const DEKA = {
  supermarket: 'dekamarkt',
  kind: 'product',
  url: 'https://www.dekamarkt.nl/producten/fictional-kippendij',
}
const TIME = '2026-10-14T12:00:00Z'

function product(url = PLUS.url, price = '2.45') {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    url, name: 'FICTIONAL kippendij',
    sku: 'FICTIONAL-CHICKEN-001',
    weight: { '@type': 'QuantitativeValue', value: 500, unitCode: 'GRM' },
    offers: {
      '@type': 'Offer', price, priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
    },
  }
}
function script(value, attrs = 'type="application/ld+json"') {
  return '<script ' + attrs + '>' + JSON.stringify(value) + '</script>'
}
function parse(html, source = PLUS, capturedAt = TIME) {
  return parseM3OfflineProductHtml({ source, html, capturedAt })
}

test('one authorized offline HTML page yields exactly one selected PLUS product', () => {
  const html = '<html><head>' + script({ '@type': 'WebPage', name: 'fictional' }) +
    script(product()) + '</head></html>'
  const result = parse(html)
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, 245)
  assert.equal(result.observation.pack.amount, 500)
  assert.equal(result.observation.pack.unit, 'g')
  assert.equal(result.jsonLdScriptsInspected, 2)
  assert.equal(result.provenance.sha256,
    createHash('sha256').update(html).digest('hex'))
  assert.equal(result.observation.provenance.url, PLUS.url)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.match(result.evidenceStatus, /not-retailer-verification/)
})

test('unrelated expensive recommendation in another JSON-LD script cannot contaminate basket price', () => {
  const html = script(product('https://www.plus.nl/product/fictional-recommendation', '999.00')) +
    script(product(PLUS.url, '1.25'))
  const result = parse(html)
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, 125)
  assert.equal(result.jsonLdScriptsInspected, 2)
})

test('different DekaMarkt recommendation and structured 1.5L product are source-bound', () => {
  const selected = {
    ...product(DEKA.url, '1.79'),
    size: { value: 1.5, unitCode: 'LTR' },
  }
  delete selected.weight
  const html = script({
    '@graph': [
      product('https://www.dekamarkt.nl/producten/fictional-recommendation', '0.01'),
      selected,
    ],
  })
  const result = parse(html, DEKA)
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, 179)
  assert.equal(result.observation.pack.unit, 'l')
  assert.equal(result.observation.pack.amount, 1.5)
  assert.equal(result.observation.supermarket, 'dekamarkt')
})

test('two scripts declaring the exact same product URL never yield two purchases', () => {
  const result = parse(script(product()) + script(product(PLUS.url, '0.01')))
  assert.equal(result.type, 'abstain')
  assert.equal(result.publicSavingsClaimEligible, false)
})

test('one URL-less product followed by a recommendation fails closed across the whole page', () => {
  const main = product()
  delete main.url
  const result = parse(script(main) +
    script(product('https://www.plus.nl/product/unrelated')))
  assert.equal(result.type, 'abstain')
})

test('a single legacy URL-less Product still uses conservative single-product parsing', () => {
  const original = product()
  delete original.url
  const result = parse(script(original))
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, 245)
})

test('malformed JSON-LD script invalidates the entire page, even if another script has a price', () => {
  const html = '<script type="application/ld+json">{BROKEN</script>' + script(product())
  const result = parse(html)
  assert.equal(result.type, 'abstain')
  assert.match(result.reason, /malformed/)
})

test('HTML comment and inert template prices cannot override the active Product', () => {
  const hidden = script(product(PLUS.url, '0.01'))
  const html = '<!--' + hidden + '-->' +
    '<template>' + hidden + '</template>' +
    '<noscript>' + hidden + '</noscript>' +
    '<textarea>' + hidden + '</textarea>' +
    script(product(PLUS.url, '3.11'), "data-note='safe' TYPE='application/ld+json'")
  const result = parse(html)
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, 311)
  assert.equal(result.jsonLdScriptsInspected, 1)
})

test('script data-type is not type, and duplicate type attributes never activate price data', () => {
  const html = script(product(PLUS.url, '0.01'), 'data-type="application/ld+json"') +
    script(product(PLUS.url, '0.02'), 'type="application/ld+json" type="application/ld+json"') +
    script(product(PLUS.url, '2.45'))
  const result = parse(html)
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, 245)
  assert.equal(result.jsonLdScriptsInspected, 1)
})

test('misleading script-looking HTML text and broken script boundaries abstain', () => {
  const examples = [
    script(product()) + '<script type="application/ld+json">',
    '</script>' + script(product()),
    '<!--' + script(product()),
    '<template>' + script(product()),
  ]
  for (const html of examples) {
    assert.equal(parse(html).type, 'abstain')
  }
})

test('source route, retailer binding and calendar-true capture time are required', () => {
  const html = script(product())
  for (const source of [
    { ...PLUS, supermarket: 'dekamarkt' },
    { ...PLUS, kind: 'catalog' },
    { ...PLUS, url: 'https://evil.example/product/test' },
    { ...PLUS, url: 'https://www.plus.nl/product/' },
    { ...PLUS, url: 'https://www.plus.nl/product/fictional-kippendij?secret=yes' },
    { ...PLUS, url: 'http://www.plus.nl/product/fictional-kippendij' },
  ]) {
    assert.equal(parse(html, source).type, 'abstain')
  }
  for (const invalid of [
    '2026-02-30T12:00:00Z',
    '2026-10-14T25:00:00Z',
    '2026-10-14T12:00:00+14:01',
    '2026-10-14T12:00:00-15:00',
    '2026-10-14T12:00:60Z',
    '2026-10-14',
    '2026-10-14T12:00:00+00:60',
  ]) {
    assert.equal(parse(html, PLUS, invalid).type, 'abstain', invalid)
  }
})

test('bad UTF-16, more than 2MiB HTML and more than 256KiB JSON-LD refuse', () => {
  assert.equal(parse(script(product()) + '\uD800').type, 'abstain')
  assert.equal(parse(script(product()) + ' '.repeat(2 * 1024 * 1024)).type, 'abstain')
  assert.equal(parse(script({
    ...product(), extra: 'x'.repeat(256 * 1024),
  })).type, 'abstain')
})

test('bounded JSON-LD count refuses >100 active scripts instead of discarding ambiguity', () => {
  const repeated = Array.from({ length: 101 }, (_, index) =>
    script({ '@type': 'WebPage', name: 'synthetic-' + index })).join('') +
    script(product())
  assert.equal(parse(repeated).type, 'abstain')
})

test('missing product and unknown stock never create a fabricated saving', () => {
  const noProduct = parse(script({ '@type': 'WebPage' }))
  assert.equal(noProduct.type, 'abstain')
  const unverifiedStock = product()
  unverifiedStock.offers.availability = 'https://schema.org/PreOrder'
  const row = parse(script(unverifiedStock))
  assert.equal(row.type, 'observation')
  assert.equal(row.observation.availability, 'unknown')
  assert.equal(row.publicSavingsClaimEligible, false)
})

test('private fields never leak from a rejected Product into operator diagnostic text', () => {
  const secret = 'PRIVATE_SECRET_CURRENCY_938478'
  const fake = product()
  fake.offers.priceCurrency = secret
  const result = parse(script(fake))
  assert.equal(result.type, 'abstain')
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret))
})

test('no-argument, null and hostile non-string inputs fail closed instead of throwing', () => {
  for (const args of [undefined, null, {}, { source: PLUS, html: null, capturedAt: TIME }]) {
    assert.equal(parseM3OfflineProductHtml(args).type, 'abstain')
  }
})


test('nested inert templates and orphan end tags can never smuggle a lower priced Product', () => {
  const hidden = script(product(PLUS.url, '0.01'))
  const legitimate = script(product(PLUS.url, '3.11'))
  const nested = '<template><template></template>' + hidden + '</template>' + legitimate
  const orphan = '</noscript>' + hidden
  for (const html of [nested, orphan]) {
    const result = parse(html)
    assert.equal(result.type, 'abstain')
    assert.equal(result.publicSavingsClaimEligible, false)
  }
})
