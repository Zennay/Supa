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

test('quoted fake script and template markup cannot alter structured source signals or valid product hints', () => {
  const html = [
    '<html><body><article class="product-card"',
    ' data-note="<script type=\'application/ld+json\'>{&quot;@type&quot;:&quot;Product&quot;}</script>"',
    ' data-other="<template><span class=\'price-value\'>fake</span></template>">',
    '<span class="product-name">A &lt; B</span></article></body></html>',
  ].join('')
  const result = proposeOfflineRetailerSelectors({ html, origin })
  assert.deepEqual(result.structuredSignals, {
    schemaOrgProduct: false, nextData: false, nuxtData: false, jsonLd: false,
  })
  assert.ok(result.selectors.some(x => x.field === 'name'))
  assert.ok(result.selectors.some(x => x.field === 'product'))
  assert.equal(result.selectors.some(x => x.field === 'price'), false)
})

test('genuine JSON-LD in head is detected while inert script and embedded attribute text are rejected', () => {
  const product = '{"@context":"https://schema.org","@type":"Product","name":"Synthetic"}'
  const html = [
    '<html><head><script type="application/ld+json">', product, '</script>',
    '<style>.price-value{color:red}</style></head><body>',
    '<template><script id="__NUXT_DATA__" type="application/json">[]</script></template>',
    '<noscript><script id="__NEXT_DATA__" type="application/json">{}</script></noscript>',
    '<span class="price-value">0</span></body></html>',
  ].join('')
  const result = proposeOfflineRetailerSelectors({ html, origin })
  assert.deepEqual(result.structuredSignals, {
    schemaOrgProduct: true, nextData: false, nuxtData: false, jsonLd: true,
  })
  assert.ok(result.selectors.some(x => x.field === 'price'))
})

test('quoted tag-like content does not consume following visible price selectors', () => {
  const html = '<article data-description="<script id=\'__NUXT_DATA__\'>[]</script>">' +
    '<span class="price-value">0</span></article>'
  const report = proposeOfflineRetailerSelectors({ html, origin })
  assert.equal(report.structuredSignals.nuxtData, false)
  assert.ok(report.selectors.some(x => x.selector === 'span.price-value'))
})

test('invalid or ambiguous structural evidence fails closed without a selector or price promotion', () => {
  for (const html of [
    '<article class="price-value" class="product-name">Duplicate</article>',
    '<article data-note="unterminated><span class="price-value">0</span>',
    '<script type="application/ld+json">{"@type":"Product"}',
  ]) {
    assert.throws(() => proposeOfflineRetailerSelectors({ html, origin }), /Duplicate|Unterminated|Unbalanced/)
  }
})

test('Schema.org class IRIs and JSON-LD graphs are actual product signals, never external lookalikes', () => {
  const make = type => '<html><head><script type="application/ld+json">' +
    JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': type, name: 'Fictional' }] }) +
    '</script></head></html>'
  for (const klass of ['Product', 'https://schema.org/Product', 'http://schema.org/Product',
    ['Thing', 'https://schema.org/Product']]) {
    const report = proposeOfflineRetailerSelectors({ html: make(klass), origin })
    assert.equal(report.structuredSignals.schemaOrgProduct, true, String(klass))
    assert.equal(report.readyForIngestion, false)
  }
  const fake = proposeOfflineRetailerSelectors({
    html: make('https://attacker.example/schema.org/Product'), origin,
  })
  assert.equal(fake.structuredSignals.schemaOrgProduct, false)
  assert.equal(fake.structuredSignals.jsonLd, true)
})

test('UTF-8 encoded JSON-LD is byte-bounded rather than incorrectly using character count', () => {
  const content = JSON.stringify({ '@type': 'Product', name: '€'.repeat(370000) })
  assert.ok(content.length < 1024 * 1024)
  assert.ok(Buffer.byteLength(content) > 1024 * 1024)
  const html = '<script type="application/ld+json">' + content + '</script>'
  const result = proposeOfflineRetailerSelectors({ html, origin })
  assert.equal(result.structuredSignals.jsonLd, false)
  assert.equal(result.structuredSignals.schemaOrgProduct, false)
  assert.equal(result.productionEnabled, false)
})

test('direct selector entrypoint rejects getter, inherited and Proxy provenance with no execution', () => {
  const html = '<article class="product-card"><span class="price-value">SYNTHETIC</span></article>'
  let hits = 0
  const badOrigin = Object.defineProperty({url: origin.url, capturedAt: origin.capturedAt}, 'retailerId', {
    enumerable: true, get() { hits++; throw Error('origin getter ran') },
  })
  assert.throws(() => proposeOfflineRetailerSelectors({html, origin: badOrigin}), /Invalid or oversized/)
  const inherited = Object.create({ retailerId: 'plus' })
  inherited.url = origin.url
  inherited.capturedAt = origin.capturedAt
  assert.throws(() => proposeOfflineRetailerSelectors({html, origin: inherited}), /Invalid or oversized/)
  const proxy = new Proxy(origin, {get() { hits++; throw Error('proxy getter ran') }})
  assert.throws(() => proposeOfflineRetailerSelectors({html, origin: proxy}), /Invalid or oversized/)
  const getterTop = Object.defineProperty({origin}, 'html', {get() {hits++;throw Error('html getter ran')}})
  assert.throws(() => proposeOfflineRetailerSelectors(getterTop), /Invalid or oversized/)
  const proxyTop = new Proxy({html,origin},{get() {hits++;throw Error('top proxy getter ran')}})
  assert.throws(() => proposeOfflineRetailerSelectors(proxyTop), /Invalid or oversized/)
  assert.equal(hits,0)
  const good = proposeOfflineRetailerSelectors({html,origin})
  assert.equal(good.productionEnabled,false)
  assert.ok(good.selectors.some(s => s.field === 'product'))
})

test('revoked top-level and origin Proxies reject without leaking native TypeError', () => {
  const html = '<article class="product-card">Synthetic</article>'
  for (const target of [{html, origin}, origin]) {
    const {proxy, revoke} = Proxy.revocable(target, {})
    revoke()
    assert.throws(() => proposeOfflineRetailerSelectors(
      target === origin ? {html, origin: proxy} : proxy,
    ), /Invalid or oversized offline retailer snapshot/)
  }
})

test('fake script types cannot claim Nuxt/Next hydration signals', () => {
  for (const id of ['__NUXT_DATA__','__NEXT_DATA__']) {
    const payload = id === '__NUXT_DATA__' ? '[{}]' : '{}'
    const fake = proposeOfflineRetailerSelectors({
      html: `<script id="${id}" type="text/plain">${payload}</script>`, origin,
    })
    assert.equal(fake.structuredSignals.nuxtData, false)
    assert.equal(fake.structuredSignals.nextData, false)
    const real = proposeOfflineRetailerSelectors({
      html: `<script id="${id}" type="application/json">${payload}</script>`, origin,
    })
    assert.equal(real.structuredSignals[id === '__NUXT_DATA__' ? 'nuxtData' : 'nextData'], true)
    assert.equal(real.productionEnabled, false)
    assert.equal(real.permissionVerified, false)
  }
})

test('plain-text and legacy fallback containers cannot supply spoofed product or selector signals', () => {
  for (const tag of ['plaintext', 'noembed', 'noframes']) {
    const forged = `<${tag}><article class="product-card"><script type="application/ld+json">{"@type":"Product"}</script></${tag}>`
    const report = proposeOfflineRetailerSelectors({ html: forged, origin })
    assert.equal(report.structuredSignals.jsonLd, false, tag)
    assert.equal(report.structuredSignals.schemaOrgProduct, false, tag)
    assert.equal(report.scannedTags, 0, tag)
    assert.equal(report.selectors.length, 0, tag)
    assert.equal(report.readyForIngestion, false)
  }
  const legitimate = proposeOfflineRetailerSelectors({html:
    '<noembed><article class="product-card">hidden</article></noembed><article class="product-card">visible</article>', origin})
  assert.equal(legitimate.scannedTags, 1)
  assert.ok(legitimate.selectors.some(x => x.field === 'product'))
})

test('invalid HTML spacing in start/end tags cannot reveal inert Product markup', () => {
  for (const [html, hiddenField] of [
    ['<script type="text/plain">ignore</ script><span class="price-value">SYNTHETIC</span></script>', 'price'],
    ['<template><div class="price-value">ignore</div></ template><article class="product-card">SYNTHETIC</article></template>', 'product'],
  ]) {
    const report=proposeOfflineRetailerSelectors({html,origin})
    assert.equal(report.selectors.some(row=>row.field===hiddenField),false)
    assert.equal(report.productionEnabled,false)
  }
  const bogus='< script type="application/ld+json">{"@type":"Product"}</script>'
  const report=proposeOfflineRetailerSelectors({html:bogus,origin})
  assert.equal(report.structuredSignals.schemaOrgProduct,false)
  assert.equal(report.structuredSignals.jsonLd,false)
  assert.equal(report.selectors.length,0)
})

test('HTML declarations and quoted processing instructions are never real Product DOM sources', () => {
  const fake='<script type="application/ld+json">{"@type":"Product"}</script>'
  const html=`<!DOCTYPE html SYSTEM "${fake}"><article class="product-card">SYNTHETIC</article>`
  const report=proposeOfflineRetailerSelectors({html,origin})
  assert.equal(report.structuredSignals.jsonLd,false)
  assert.equal(report.structuredSignals.schemaOrgProduct,false)
  assert.ok(report.selectors.some(x=>x.selector==='article.product-card'))
  const pi=`<?xml version="1.0" note="${fake}"><div class="price-value">SYNTHETIC</div>`
  const second=proposeOfflineRetailerSelectors({html:pi,origin})
  assert.equal(second.structuredSignals.jsonLd,false)
  assert.ok(second.selectors.some(x=>x.selector==='div.price-value'))
  assert.throws(()=>proposeOfflineRetailerSelectors({
    html:`<!DOCTYPE html [ ${fake} ]>`,origin,
  }),/Malformed offline tag/)
})

test('real HTML custom-element retail tags generate only observed selectors, never invented shadow DOM', () => {
  const html='<plus-product-tile class="product-card"><plus-price-label class="price-value">SYNTHETIC</plus-price-label></plus-product-tile>'
  const report=proposeOfflineRetailerSelectors({html,origin})
  assert.ok(report.selectors.some(x=>x.selector==='plus-product-tile.product-card'))
  assert.ok(report.selectors.some(x=>x.selector==='plus-price-label.price-value'))
  assert.equal(report.selectors.some(x=>x.selector.includes('shadow-root')),false)
  assert.equal(report.readyForIngestion,false)
  const fake='<template>'+html+'</template>'
  assert.equal(proposeOfflineRetailerSelectors({html:fake,origin}).selectors.length,0)
})
