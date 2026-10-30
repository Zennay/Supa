import assert from 'node:assert/strict'
import test from 'node:test'
import { proposeOfflineRetailerSelectors } from '../scripts/retailer-offline-selector-discovery.mjs'

const origin = {
  retailerId: 'plus',
  url: 'https://www.plus.nl/producten',
  capturedAt: '2026-10-14T12:00:00.000Z',
}
const sample = [
  '<!doctype html><html lang="nl"><body>',
  '<section class="plp-product-card"><a href="/product/test-product-1234"><span class="product-name">Fictional item</span></a>',
  '<span class="price-value">€1,99</span><div data-testid="pack-size">200 ml</div></section>',
  '<div class="offer-label">Fictional deal</div>',
  '<script type="application/ld+json">{"@type":"Product","name":"Fake"}</script>',
  '</body></html>',
].join('')

test('proposes per-retailer candidate selectors from bounded synthetic HTML without exporting price or product text', () => {
  const original = sample
  const result = proposeOfflineRetailerSelectors({ html: sample, origin })
  assert.equal(result.mode, 'offline-selector-proposals-only')
  assert.equal(result.source.retailerId, 'plus')
  assert.match(result.source.sha256, /^[a-f0-9]{64}$/)
  assert.equal(result.structuredSignals.jsonLd, true)
  assert.equal(result.structuredSignals.schemaOrgProduct, true)
  assert.equal(result.humanReviewRequired, true)
  for (const field of ['product', 'name', 'price', 'pack', 'offer']) {
    assert.ok(result.selectors.some(c => c.field === field), field)
  }
  assert.ok(result.selectors.some(c => c.selector === 'a[href^="/product/"]'))
  assert.ok(result.selectors.some(c => c.selector === 'div[data-testid="pack-size"]'))
  assert.ok(result.selectors.every(c => c.status === 'needs-human-review'))
  assert.equal(result.readyForIngestion, false)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.permissionVerified, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.doesNotMatch(JSON.stringify(result), /Fictional|€|1,99|Fake|test-product-1234|www\.plus\.nl/i)
  assert.equal(sample, original)
})

test('DekaMarkt and unknown research stores use the same normalized output without assuming a parser or license', () => {
  const html = '<html><body><article class="product-card"><a href="/producten/item/22"><h3 class="product-title">Test</h3></a><span data-testid="price-value">9,99</span></article></body></html>'
  for (const [retailerId, url] of [
    ['dekamarkt', 'https://www.dekamarkt.nl/producten'],
    ['fictional-retailer', 'https://fictional.example/catalog'],
  ]) {
    const result = proposeOfflineRetailerSelectors({ html, origin: { ...origin, retailerId, url } })
    assert.equal(result.source.retailerId, retailerId)
    assert.ok(result.selectors.some(c => c.selector === 'a[href^="/producten/"]'))
    assert.ok(result.selectors.some(c => c.field === 'price'))
    assert.equal(result.readyForIngestion, false)
  }
})

test('scripts, fake comments and inert template markup may not produce observable DOM selector candidates', () => {
  const html = [
    '<html><body><span class="product-name">Actual anonymous label</span>',
    '<!-- <span class="price-value">Fake price</span> -->',
    '<template><div class="stock-availability">Hidden</div></template>',
    '<script type="text/javascript"><div class="offer-promo">Faked</div></script>',
    '<style>.pack-unit{}</style></body></html>',
  ].join('')
  const report = proposeOfflineRetailerSelectors({ html, origin })
  const fields = new Set(report.selectors.map(s => s.field))
  assert.equal(fields.has('name'), true)
  for (const rejected of ['price', 'availability', 'offer', 'pack']) {
    assert.equal(fields.has(rejected), false, rejected)
  }
  assert.doesNotMatch(JSON.stringify(report), /Fake|Actual anonymous|Hidden/i)
})

test('invalid private origins, credentials, URL search parameters, malformed source times and future captures reject', () => {
  for (const update of [
    { url: 'http://www.plus.nl/producten' },
    { url: 'https://user:pass@www.plus.nl/producten' },
    { url: 'https://www.plus.nl/producten?token=private' },
    { url: 'https://www.plus.nl/producten#fragment' },
    { url: 'https://localhost/product' },
    { url: 'https://127.0.0.1/product' },
    { retailerId: '../evil' },
    { capturedAt: 'not-a-timestamp' },
    { capturedAt: '2999-10-14T12:00:00.000Z' },
  ]) {
    assert.throws(() => proposeOfflineRetailerSelectors({ html: sample, origin: { ...origin, ...update } }), /Invalid or oversized/)
  }
})

test('ambiguous unclosed comment, script and template fail closed instead of proposing false markup', () => {
  for (const html of [
    '<!-- <a class="product-card" href="/product/hijack">',
    '<script type="text/javascript"><div class="price-value">',
    '<template><span class="price-value">Hidden',
  ]) {
    assert.throws(() => proposeOfflineRetailerSelectors({ html, origin }), /Unterminated|Unbalanced/)
  }
})

test('bounded, deterministic output for repeated tags and oversized HTML; no live network required', () => {
  const markup = '<div class="product-card"><span class="price-value">9.99</span></div>'.repeat(250)
  const first = proposeOfflineRetailerSelectors({ html: markup, origin })
  const second = proposeOfflineRetailerSelectors({ html: markup, origin })
  assert.deepEqual(first, second)
  assert.ok(first.selectors.every(s => s.instances === 250))
  assert.ok(first.selectors.length <= 24)
  assert.throws(() => proposeOfflineRetailerSelectors({ html: 'x'.repeat(2 * 1024 * 1024 + 1), origin }), /Invalid or oversized/)
})

test('attribute aliases cannot impersonate real class, data-testid, itemprop or href selectors', () => {
  const spoofed = '<article data-class="price-value" data-data-testid="pack-size" ' +
    'aria-itemprop="product-name" data-href="/product/fictional-123">Synthetic</article>'
  const result = proposeOfflineRetailerSelectors({ html: spoofed, origin })
  assert.deepEqual(result.selectors, [])
  assert.equal(result.productionEnabled, false)
})

test('HTML-like text inside a quoted attribute must never create fake DOM selector candidates', () => {
  const markup = `<div data-note="<span class='offer-promo'>fake</span>" class="ordinary"></div>`
  const result = proposeOfflineRetailerSelectors({ html: markup, origin })
  assert.equal(result.selectors.length, 0)
  assert.equal(result.readyForIngestion, false)
})
