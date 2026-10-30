import assert from 'node:assert/strict'
import test from 'node:test'
import { proposeOfflineRetailerSelectors, summarizeOfflineSelectorProposals } from '../scripts/retailer-offline-selector-discovery.mjs'

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
  '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Fake"}</script>',
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

test('historical retailer snapshots require observed allowed storefront routes', () => {
  for (const retailerId of ['plus','dekamarkt']) {
    const host = retailerId === 'plus' ? 'www.plus.nl' : 'www.dekamarkt.nl'
    for (const path of ['/admin', '/checkout', '/mijn-account',
                        '/producten//admin', '/aanbiedingen//checkout',
                        '/producten/%2fadmin', '/producten/%252fadmin']) {
      const originRecord = { ...origin, retailerId,
        url: 'https://' + host + path }
      assert.throws(() => proposeOfflineRetailerSelectors({
        html: '<a href="/product/synthetic-123">Mock</a>', origin: originRecord,
      }), /Invalid or oversized offline retailer snapshot/)
    }
  }
  for (const path of ['/producten', '/aanbiedingen', '/product/synthetic-123']) {
    const report = proposeOfflineRetailerSelectors({ html: '<div class="product-card"></div>',
      origin: { ...origin, url: 'https://www.plus.nl' + path } })
    assert.equal(report.readyForIngestion, false)
  }
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

test('valid omitted head close before body preserves real JSON-LD and visible source DOM', () => {
  const html='<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product"}</script><body><article class="product-card">SYNTHETIC</article></body></html>'
  const report=proposeOfflineRetailerSelectors({html,origin})
  assert.equal(report.structuredSignals.schemaOrgProduct,true)
  assert.ok(report.selectors.some(x=>x.selector==='article.product-card'))
  assert.equal(report.productionEnabled,false)
  assert.throws(()=>proposeOfflineRetailerSelectors({html:
    '<head><template><body><article class="price-value">Fake</article></body>',origin,
  }),/Unbalanced inert HTML element/)
})


test('offline CSS class proposals count actual matching tags once and respect HTML ASCII whitespace', () => {
  // HTML classList: duplicate tokens still select one tag, and U+00A0
  // is NOT whitespace, unlike JavaScript String.split(/\s+/).
  const html = [
    '<article class="product-card product-card product-card"><span class="price-value price-value">a</span></article>',
    '<article class="product-card\tproduct-card"><span class="price-value\nprice-value">b</span></article>',
    '<article class="price-value\u00a0shadow">c</article>',
  ].join('')
  const report = proposeOfflineRetailerSelectors({ html, origin })
  const product = report.selectors.find(s => s.selector === 'article.product-card')
  const price = report.selectors.find(s => s.selector === 'span.price-value')
  assert.equal(product?.instances, 2)
  assert.equal(price?.instances, 2)
  assert.equal(report.selectors.some(s => s.selector === 'article.price-value'), false)
  assert.equal(report.readyForIngestion, false)
  assert.equal(report.permissionVerified, false)
})

test('structural selector evidence never advertises duplicate-key JSON-LD or Nuxt as verified source signals', () => {
  const html = [
    '<html><body>',
    '<script type="application/ld+json">{\"@type\":\"Thing\",\"\\u0040type\":\"Product\"}</script>',
    '<script id="__NUXT_DATA__" type="application/json">[{\"productId\":7,\"productId\":8}]</script>',
    '<span class="product-name">Inert text</span>',
    '</body></html>',
  ].join('')
  const report = proposeOfflineRetailerSelectors({ html, origin })
  assert.equal(report.structuredSignals.jsonLd, false)
  assert.equal(report.structuredSignals.schemaOrgProduct, false)
  assert.equal(report.structuredSignals.nuxtData, false)
  assert.equal(report.selectors.some(x => x.field === 'name'), true)
  assert.equal(report.permissionVerified, false)
})


test('CSS hints reflect actual decoded numeric HTML attribute references, never invented labels', () => {
  const html = [
    '<article class="product&#45;card product&#45;card">',
    '<span data-testid="price&#x2d;value">Synthetic</span>',
    '<a href="&#47;product&#47;synthetic-555">Source link</a>',
    '<span class="price&#xD800;value">Invalid surrogate stays inert</span>',
    '</article>',
  ].join('')
  const report = proposeOfflineRetailerSelectors({ html, origin })
  assert.equal(report.selectors.find(x => x.selector === 'article.product-card')?.instances, 1)
  assert.equal(report.selectors.find(x => x.selector === 'span[data-testid="price-value"]')?.instances, 1)
  assert.equal(report.selectors.find(x => x.selector === 'a[href^="/product/"]')?.instances, 1)
  assert.equal(report.selectors.some(x => x.selector === 'span.price-value'), false)
  assert.equal(report.readyForIngestion, false)
})


test('structural capture signals match valid script type whitespace and still refuse attribute aliases', () => {
  const html = [
    '<html><head>',
    '<script type="  Application/LD+JSON  ">{"@context":"https://schema.org","@type":"Product","name":"Synthetic"}</script>',
    '<script id="__NUXT_DATA__" type="  APPLICATION/JSON  ">[42]</script>',
    '<script data-type="application/ld+json">{"@type":"Product"}</script>',
    '</head><body><span class="product-name">Observed</span></body></html>',
  ].join('')
  const result = proposeOfflineRetailerSelectors({ html, origin })
  assert.equal(result.structuredSignals.schemaOrgProduct, true)
  assert.equal(result.structuredSignals.jsonLd, true)
  assert.equal(result.structuredSignals.nuxtData, true)
  assert.equal(result.readyForIngestion, false)
})

test('PLUS and Deka link selectors require genuine observed store product paths, not catalog navigation', () => {
  const badPlus = [
    '/product/', '/product/?sort=price', '/product//nested',
    '/product/../admin', '/product/%2e%2e/admin',
    '/product/%2fencoded', '/producten/deka-item-99',
  ].map(href => '<a href="' + href + '">Synthetic navigation</a>').join('')
  const plus = proposeOfflineRetailerSelectors({
    html: badPlus + '<a href="/product/fictional-item-123">Valid synthetic item</a>',
    origin,
  })
  assert.equal(plus.selectors.find(x => x.selector === 'a[href^="/product/"]')?.instances, 1)
  assert.equal(plus.selectors.some(x => x.selector === 'a[href^="/producten/"]'), false)
  const onlyBad = proposeOfflineRetailerSelectors({html: badPlus, origin})
  assert.equal(onlyBad.selectors.length, 0)
  const dekaOrigin = {...origin, retailerId: 'dekamarkt',
    url: 'https://www.dekamarkt.nl/producten'}
  const deka = proposeOfflineRetailerSelectors({
    html: '<a href="/producten/">Catalog root</a>' +
      '<a href="/producten/?sort=offer">Catalog navigation</a>' +
      '<a href="/product/foreign-123">Wrong retailer route</a>' +
      '<a href="/producten/fictional/123">Synthetic Deka item</a>',
    origin: dekaOrigin,
  })
  assert.equal(deka.selectors.find(x => x.selector === 'a[href^="/producten/"]')?.instances, 1)
  assert.equal(deka.selectors.some(x => x.selector === 'a[href^="/product/"]'), false)
  assert.equal(deka.published, undefined)
  assert.equal(deka.readyForIngestion, false)
})

test('same-merchant absolute and protocol-relative observed item links produce actual CSS selectors only', () => {
  const html = [
    '<a href="https://www.plus.nl/product/fictional-11">Valid absolute</a>',
    '<a href="//www.plus.nl/product/fictional-22">Valid scheme-relative</a>',
    '<a href="https://www.dekamarkt.nl/producten/foreign-33">Wrong merchant</a>',
    '<a href="https://www.plus.nl/product/">Catalog root</a>',
    '<a href="https://www.plus.nl/product/../admin">Traversal</a>',
    '<a href="http://www.plus.nl/product/fictional-44">Wrong scheme</a>',
    '<a href="https://other.example/product/fictional-55">Foreign host</a>',
  ].join('')
  const result = proposeOfflineRetailerSelectors({html, origin})
  assert.equal(result.selectors.find(x =>
    x.selector === 'a[href^="https://www.plus.nl/product/"]')?.instances, 1)
  assert.equal(result.selectors.find(x =>
    x.selector === 'a[href^="//www.plus.nl/product/"]')?.instances, 1)
  assert.equal(result.selectors.some(x => x.selector === 'a[href^="/product/"]'), false)
  assert.equal(result.selectors.length, 2)
  assert.equal(result.readyForIngestion, false)

  const deka = proposeOfflineRetailerSelectors({
    html: '<a href="https://www.dekamarkt.nl/producten/fictional-123">Deka absolute</a>' +
      '<a href="//www.dekamarkt.nl/producten/fictional-456">Deka scheme relative</a>' +
      '<a href="https://www.plus.nl/product/foreign-1">Other store</a>',
    origin: { ...origin, retailerId: 'dekamarkt',
      url: 'https://www.dekamarkt.nl/producten' },
  })
  assert.equal(deka.selectors.length, 2)
  assert.equal(deka.selectors.some(x =>
    x.selector === 'a[href^="https://www.dekamarkt.nl/producten/"]'), true)
  assert.equal(deka.selectors.some(x =>
    x.selector === 'a[href^="//www.dekamarkt.nl/producten/"]'), true)
})

test('live HTML base href cannot redirect source product anchors to another origin', () => {
  const item = '<body><a href="/product/synthetic-123">Synthetic</a></body>'
  for (const base of [
    'https://outside.example/', '//outside.example/catalog/',
    'http://www.plus.nl/', 'https://www.plus.nl.evil.example/',
    'javascript:alert(1)',
  ]) {
    const html = '<html><head><base href="' + base + '"></head>' + item + '</html>'
    assert.throws(() => proposeOfflineRetailerSelectors({html, origin}), /Untrusted HTML base URL/)
  }
  for (const base of ['https://www.plus.nl/', '/', '//www.plus.nl/producten']) {
    const html = '<html><head><base href="' + base + '"></head>' + item + '</html>'
    const report = proposeOfflineRetailerSelectors({html, origin})
    assert.equal(report.selectors.find(x=>x.selector==='a[href^="/product/"]')?.instances,1)
  }
  const hidden = '<html><head><template><base href="https://outside.example/"></template></head>' +
    item + '</html>'
  assert.equal(proposeOfflineRetailerSelectors({html:hidden, origin}).selectors.length, 1)
  const duplicate = '<html><head><base href="/"><base href="/"></head>' + item + '</html>'
  assert.throws(()=>proposeOfflineRetailerSelectors({html:duplicate, origin}),
    /Multiple live HTML base URLs/)
})

test('live canonical source URL cannot attribute foreign product pages to PLUS', () => {
  const item='<body><a href="/product/synthetic-123">Synthetic item</a></body>'
  for (const canonical of [
    'https://other.example/product/foreign-5',
    '//www.dekamarkt.nl/producten/foreign-6',
    'http://www.plus.nl/product/synthetic-123',
    'https://user@example.com/product/synthetic-456',
  ]) {
    const html='<html><head><link rel="canonical" href="'+canonical+'"></head>'+item+'</html>'
    assert.throws(()=>proposeOfflineRetailerSelectors({html,origin}),
      /Untrusted HTML canonical source URL/)
  }
  for (const canonical of [
    'https://www.plus.nl/producten',
    '/producten',
  ]) {
    const html='<html><head><link rel="canonical" href="'+canonical+'"></head>'+item+'</html>'
    const result=proposeOfflineRetailerSelectors({html,origin})
    assert.equal(result.selectors.find(x=>x.selector==='a[href^="/product/"]')?.instances,1)
    assert.doesNotMatch(JSON.stringify(result),/canonical|synthetic-123/)
  }
  const inert='<html><head><template><link rel="canonical" href="https://other.example/"></template></head>'+item+'</html>'
  assert.equal(proposeOfflineRetailerSelectors({html:inert,origin}).selectors.length,1)
  const duplicate='<html><head><link rel="canonical" href="/producten"><link rel="canonical" href="/producten"></head>'+item+'</html>'
  assert.throws(()=>proposeOfflineRetailerSelectors({html:duplicate,origin}),
    /Ambiguous canonical retailer source URL/)
  const empty='<html><head><link rel="canonical"></head>'+item+'</html>'
  assert.throws(()=>proposeOfflineRetailerSelectors({html:empty,origin}),
    /Ambiguous canonical retailer source URL/)
})

test('archived snapshot origin and product anchors reject encoded HTTP control bytes', () => {
  const bad=['%00','%09','%1f','%7f','%2e','%25']
  for (const control of bad) {
    const html='<html><body><a href="/product/synthetic'+control+
      'bad">SYNTHETIC</a></body></html>'
    const source=proposeOfflineRetailerSelectors({html,origin})
    assert.equal(source.selectors.filter(s=>s.field==='product').length,0)
    assert.throws(()=>proposeOfflineRetailerSelectors({
      html:'<article class="product-card">SYNTHETIC</article>',
      origin:{...origin,url:'https://www.plus.nl/product/synthetic'+control+'bad'},
    }),/Invalid or oversized offline retailer snapshot/)
  }
  const valid=proposeOfflineRetailerSelectors({
    html:'<a href="/product/observed-%20space">SYNTHETIC</a>',origin,
  })
  assert.equal(valid.selectors.find(x=>x.selector==='a[href^="/product/"]')?.instances,1)
  assert.equal(valid.readyForIngestion,false)
})

test('source-observed named HTML href entities yield actual DOM-equivalent product selectors', () => {
  const markup = '<html><body>' +
    '<a href="&sol;product/mock-111">SYNTHETIC</a>' +
    '<a href="https&colon;//www.plus.nl/product/mock-222">SYNTHETIC</a>' +
    '<a href="&SOL;product/not-real">Unknown entity, no selector</a>' +
    '<a href="&sol;producten/deka-only">Wrong merchant route</a>' +
    '</body></html>'
  const review = proposeOfflineRetailerSelectors({ html: markup, origin }, true)
  assert.equal(review.selectors.find(x => x.selector === 'a[href^="/product/"]')?.instances, 1)
  assert.equal(review.selectors.find(x =>
    x.selector === 'a[href^="https://www.plus.nl/product/"]')?.instances, 1)
  assert.equal(review.observedProductLinkOccurrences, 2)
  assert.equal(review.distinctObservedProductPaths, 2)
  assert.equal(review.readyForIngestion, false)
  assert.doesNotMatch(JSON.stringify(review), /mock-111|mock-222|not-real/i)
})

test('parent-relative product anchors are accepted only when the real page base resolves to a store item', () => {
  for (const [retailerId, host, productRoot] of [
    ['plus','www.plus.nl','product/'],
    ['dekamarkt','www.dekamarkt.nl','producten/'],
  ]) {
    const source={retailerId,capturedAt:origin.capturedAt,
      url:'https://' + host + '/aanbiedingen/week'}
    const markup='<html><body><a href="../' + productRoot +
      'synthetic-item-111">SYNTHETIC</a></body></html>'
    const accepted=proposeOfflineRetailerSelectors({html:markup,origin:source})
    assert.equal(accepted.selectors.find(x =>
      x.selector === 'a[href^="../' + productRoot + '"]')?.instances,1)
    assert.equal(accepted.readyForIngestion,false)
    const changedBase='<html><head><base href="/aanbiedingen/week/"></head>' +
      '<body><a href="../' + productRoot + 'synthetic-item-111">SYNTHETIC</a></body></html>'
    assert.throws(() => proposeOfflineRetailerSelectors({html:changedBase,origin:source}),
      /Untrusted HTML base URL/)
  }
})

test('resolves only source-observed relative product links under effective HTML base', () => {
  for (const [retailerId, host, itemRoot] of [
    ['plus', 'www.plus.nl', 'product/'],
    ['dekamarkt', 'www.dekamarkt.nl', 'producten/'],
  ]) {
    const source = { retailerId, capturedAt: origin.capturedAt,
      url: 'https://' + host + '/aanbiedingen/week' }
    const html = '<html><head><base href="/"></head><body>' +
      '<a href="' + itemRoot + 'synthetic-abc">Synthetic product</a>' +
      '<a href="./' + itemRoot + 'synthetic-xyz">Synthetic product</a>' +
      '<a href="' + itemRoot + '%252fescape">Ambiguous double-encoded</a>' +
      '<a href="' + itemRoot + '%2etrick">Encoded dot</a>' +
      '</body></html>'
    const report = proposeOfflineRetailerSelectors({ html, origin: source }, true)
    assert.equal(report.selectors.find(x =>
      x.selector === 'a[href^="' + itemRoot + '"]')?.instances, 1)
    assert.equal(report.selectors.find(x =>
      x.selector === 'a[href^="./' + itemRoot + '"]')?.instances, 1)
    assert.equal(report.observedProductLinkOccurrences, 2)
    assert.equal(report.distinctObservedProductPaths, 2)
    assert.equal(report.readyForIngestion, false)
    assert.doesNotMatch(JSON.stringify(report), /synthetic-abc|synthetic-xyz/i)
    const withoutBase = html.replace('<base href="/">','')
    const invalid = proposeOfflineRetailerSelectors({
      html: withoutBase, origin: source,
    })
    assert.equal(invalid.selectors.filter(x => x.field === 'product').length, 0)
  }
})

test('offline archive cannot forge same-store SKU identity or entity-encoded base', () => {
  const cases = [
    { canonical: '/product/different-sku' },
    { canonical: '/aanbiedingen' },
    { canonical: '/producten?shop=other' },
    { canonical: '/producten#foo' },
    { canonical: '&#47;&#47;other.example/producten' },
    { base: 'https&#58;//other.example/' },
    { base: '&#47;&#47;other.example/' },
  ]
  for (const entry of cases) {
    const name = entry.base ? 'base' : 'canonical'
    const tag = entry.base ? 'base' : 'link rel="canonical"'
    const href = entry.base ?? entry.canonical
    const page = '<html><head><' + tag + ' href="' + href + '">' +
      '</head><body><a href="/product/mock-123">MOCK</a></body></html>'
    assert.throws(() => proposeOfflineRetailerSelectors({ html: page, origin }),
      new RegExp('Untrusted HTML ' + (name === 'base' ? 'base' : 'canonical')))
  }
  const identity = { ...origin, url: 'https://www.plus.nl/product/mock-123' }
  const mismatch = '<html><head><link rel="canonical" href="/product/mock-456">' +
    '</head><body><a href="/product/mock-123">MOCK</a></body></html>'
  assert.throws(() => proposeOfflineRetailerSelectors({ html: mismatch, origin: identity }),
    /Untrusted HTML canonical source URL/)
  const valid = '<html><head><link rel="canonical" href="/producten/">' +
    '</head><body><a href="/product/mock-123">MOCK</a></body></html>'
  const report = proposeOfflineRetailerSelectors({ html: valid, origin })
  assert.equal(report.selectors.find(x => x.selector === 'a[href^="/product/"]')?.instances, 1)
  assert.equal(report.readyForIngestion, false)
})

test('live HTML meta refresh cannot masquerade as a stable catalog product source', () => {
  const item='<body><a href="/product/synthetic-42">Synthetic</a></body>'
  for (const attr of [
    'http-equiv="refresh" content="0;url=https://foreign.example/product"',
    'HTTP-EQUIV="  REFRESH  " CONTENT="3;URL=/other-page"',
  ]) {
    const page='<html><head><meta '+attr+'></head>'+item+'</html>'
    assert.throws(()=>proposeOfflineRetailerSelectors({html:page,origin}),
      /Untrusted HTML redirect evidence/)
  }
  const hidden='<html><head><template><meta http-equiv="refresh" content="0;url=evil"></template></head>'+item+'</html>'
  const normal='<html><head><meta data-http-equiv="refresh" content="0;url=evil"></head>'+item+'</html>'
  for (const html of [hidden,normal]) {
    assert.equal(proposeOfflineRetailerSelectors({html,origin}).selectors.find(x=>
      x.selector==='a[href^="/product/"]')?.instances,1)
  }
})

test('private HTML listing coverage counts distinct observed products, not repeated links or tracking URLs',()=>{
  const html=[
    '<a href="/product/synthetic-1">Item 1</a>',
    '<a href="https://www.plus.nl/product/synthetic-1?utm_source=mock">Repeated link</a>',
    '<a href="//www.plus.nl/product/synthetic-1#details">Repeated third link</a>',
    '<a href="/product/synthetic-2">Item 2</a>',
    '<a href="/producten/foreign-3">Unrelated store route</a>',
    '<a href="/product/">Catalog root</a>',
  ].join('')
  const normal=proposeOfflineRetailerSelectors({html,origin})
  assert.equal('observedProductLinkOccurrences' in normal,false)
  assert.equal('distinctObservedProductPaths' in normal,false)
  const privateReview=proposeOfflineRetailerSelectors({html,origin},true)
  assert.equal(privateReview.observedProductLinkOccurrences,4)
  assert.equal(privateReview.distinctObservedProductPaths,2)
  assert.equal(privateReview.readyForIngestion,false)
  assert.doesNotMatch(JSON.stringify(privateReview),/synthetic-1|synthetic-2|utm_source/)
})

test('private offline proposals refuse live no-store meta while ignoring inert fake tags', () => {
  const origin={retailerId:'plus',url:'https://www.plus.nl/producten',capturedAt:'2026-10-14T12:00:00.000Z'}
  const anchor='<a href="/product/synthetic-1">SYNTHETIC</a>'
  const meta='<meta http-equiv="Cache-Control" content="no-store">'
  const page=tag=>'<html><head>'+tag+'</head><body>'+anchor+'</body></html>'
  assert.throws(()=>proposeOfflineRetailerSelectors({html:page(meta),origin}),
    /Untrusted HTML no-store archival directive/)
  const allowed=proposeOfflineRetailerSelectors({html:page('<template>'+meta+'</template>'),origin})
  assert.equal(allowed.selectors.find(x=>x.selector==='a[href^="/product/"]')?.instances,1)
  assert.equal(allowed.readyForIngestion,false)
})

test('captured HTML archival directives disallow semicolon no-store and robots noarchive, never inert fakes', () => {
  const anchor='<a href="/product/synthetic-1">SYNTHETIC</a>'
  const page=tag=>'<html><head>'+tag+'</head><body>'+anchor+'</body></html>'
  for (const meta of [
    '<meta http-equiv="Cache-Control" content="private; no-store">',
    '<meta http-equiv="Cache-Control" content="max-age=0;NO-STORE">',
    '<meta name="robots" content="index, noarchive, follow">',
    '<meta name="Googlebot" content="NOARCHIVE">',
  ]) {
    assert.throws(()=>proposeOfflineRetailerSelectors({html:page(meta),origin}),
      /Untrusted HTML (?:no-store archival|robots noarchive) directive/,meta)
    const inert=proposeOfflineRetailerSelectors({html:page('<template>'+meta+'</template>'),origin})
    assert.equal(inert.selectors.some(x=>x.selector==='a[href^="/product/"]'),true)
  }
  const benign=proposeOfflineRetailerSelectors({html:page('<meta name="robots" content="index, follow">'),origin})
  assert.equal(benign.readyForIngestion,false)
})

test('HTML character-referenced meta controls cannot disguise archival opt-outs', () => {
  const page=meta=>'<html><head>'+meta+'</head><body><a href="/product/synthetic-12">SYNTHETIC</a></body></html>'
  for (const meta of [
    '<meta name="ro&#98;ots" content="no&#97;rchive">',
    '<meta name="robots" content="no&#x61;rchive">',
    '<meta http-equiv="Cache&#45;Control" content="no&#45;store">',
    '<meta http-equiv="Refre&#115;h" content="0;url=/checkout">',
  ]) assert.throws(()=>proposeOfflineRetailerSelectors({html:page(meta),origin}),
    /Untrusted HTML/,meta)
  const inert=proposeOfflineRetailerSelectors({html:page('<template><meta name="robots" content="no&#97;rchive"></template>'),origin})
  assert.equal(inert.readyForIngestion,false)
  assert.equal(inert.selectors.some(x=>x.field==='product'),true)
})

test('in-memory selector proposals refuse HTML BOM/NUL that browser parsing would normalize', () => {
  const origin={retailerId:'plus',url:'https://www.plus.nl/producten',
    capturedAt:'2026-10-14T12:00:00.000Z'}
  const sample='<html><body><a href="/product/synthetic-1">SYNTHETIC</a></body></html>'
  for (const html of ['\uFEFF'+sample,sample+'\u0000']) {
    assert.throws(()=>proposeOfflineRetailerSelectors({html,origin}),
      /Invalid or oversized offline retailer snapshot/)
  }
  const valid=proposeOfflineRetailerSelectors({html:sample,origin})
  assert.equal(valid.selectors.find(x=>x.selector==='a[href^="/product/"]')?.instances,1)
})

test('private HTML selector review refuses conflicting declared encoding, not inert markup', () => {
  const origin={retailerId:'plus',url:'https://www.plus.nl/producten',
    capturedAt:'2026-10-14T12:00:00.000Z'}
  const product='<a href="/product/synthetic-111">SYNTHETIC café</a>'
  const meta='<meta charset="windows-1252">'
  const page=markup=>'<html><head>'+markup+'</head><body>'+product+'</body></html>'
  assert.throws(()=>proposeOfflineRetailerSelectors({html:page(meta),origin}),
    /Untrusted HTML charset declaration/)
  const allowed=proposeOfflineRetailerSelectors({
    html:page('<template>'+meta+'</template><meta charset="utf-8">'),origin,
  })
  assert.equal(allowed.selectors.find(x=>x.selector==='a[href^="/product/"]')?.instances,1)
  assert.equal(allowed.readyForIngestion,false)
})

test('numeric canonical rel attribute identity cannot be hidden from offline source review',()=>{
  const html='<html><head><link rel="canon&#105;cal" href="https://other.example/producten"></head><body><a href="/product/synthetic-42">synthetic</a></body></html>'
  assert.throws(()=>proposeOfflineRetailerSelectors({html,origin}),/canonical/)
})

test('offline selector signals agree with UTF-8 JSON-LD and Nuxt private price evidence', () => {
  const product = '<script type="application/ld+json; charset=UTF-8">' +
    '{"@context":"https://schema.org","@type":"Product","name":"Fictional"}' +
    '</script>'
  const plus = proposeOfflineRetailerSelectors({ html: product, origin })
  assert.deepEqual(plus.structuredSignals, {
    schemaOrgProduct: true, jsonLd: true, nuxtData: false, nextData: false,
  })
  assert.equal(plus.productionEnabled, false)
  const dekaOrigin = { ...origin, retailerId:'dekamarkt',
    url:'https://www.dekamarkt.nl/producten' }
  const nuxt = '<script id="__NUXT_DATA__" type="application/json; charset=UTF-8">[]</script>'
  const deka = proposeOfflineRetailerSelectors({ html: nuxt, origin: dekaOrigin })
  assert.equal(deka.structuredSignals.nuxtData, true)
  assert.equal(deka.readyForIngestion, false)
  for (const type of ['application/ld+json; charset=latin1',
    'application/ld+json; charset=UTF-8; charset=UTF-8']) {
    const invalid = product.replace('application/ld+json; charset=UTF-8', type)
    const report = proposeOfflineRetailerSelectors({ html: invalid, origin })
    assert.equal(report.structuredSignals.jsonLd, false)
    assert.equal(report.structuredSignals.schemaOrgProduct, false)
  }
})

test('encoded script MIME types produce the same offline source signals as private price extraction', () => {
  const valid = '<script type="application/ld+json&#59;charset=utf-8">' +
    '{"@context":"https://schema.org","@type":"Product","name":"synthetic"}</script>'
  const source = proposeOfflineRetailerSelectors({ html: valid, origin })
  assert.equal(source.structuredSignals.jsonLd, true)
  assert.equal(source.structuredSignals.schemaOrgProduct, true)
  assert.equal(source.readyForIngestion, false)
  const encodedInvalid = valid.replace('&#59;charset=utf-8','&amp;semi;charset=utf-8')
  const refused = proposeOfflineRetailerSelectors({ html: encodedInvalid, origin })
  assert.equal(refused.structuredSignals.jsonLd, false)
  assert.equal(refused.structuredSignals.schemaOrgProduct, false)
})

test('offline Nuxt and Next signals decode genuine script id HTML entities exactly once', () => {
  const nuxt = '<script id="__NUXT_D&#x41;TA__" type="application/json">[]</script>'
  const next = '<script id="__NEXT_D&#65;TA__" type="application/json">{}</script>'
  const report = proposeOfflineRetailerSelectors({ html: nuxt + next, origin })
  assert.equal(report.structuredSignals.nuxtData, true)
  assert.equal(report.structuredSignals.nextData, true)
  assert.equal(report.readyForIngestion, false)
  const nested = '<script id="__NUXT_D&amp;#65;TA__" type="application/json">[]</script>'
  const rejected = proposeOfflineRetailerSelectors({ html: nested, origin })
  assert.equal(rejected.structuredSignals.nuxtData, false)
  const unrelated = '<script id="other&#65;" type="text/plain">x</script>'
  const accepted = proposeOfflineRetailerSelectors({ html: unrelated + nuxt, origin })
  assert.equal(accepted.structuredSignals.nuxtData, true)
})


test('official named HTML script id references match the actual Nuxt/Next DOM metadata', () => {
  const html = '<script id="__NUXT&lowbar;DATA__" type="application&sol;json">[]</script>' +
    '<script id="__NEXT&lowbar;DATA__" type="application&sol;json">{}</script>'
  const result = proposeOfflineRetailerSelectors({ html, origin })
  assert.equal(result.structuredSignals.nuxtData, true)
  assert.equal(result.structuredSignals.nextData, true)
  assert.equal(result.readyForIngestion, false)
  assert.equal(result.productionEnabled, false)
})

test('offline operator summary never exposes private SKU-bearing custom component names', () => {
  const html='<retailer-product-card class="product-card">' +
    '<retailer-price-label data-testid="price-value">PRIVATE_PRICE</retailer-price-label>' +
    '<retailer-product-991-card class="product-card">PRIVATE_SKU</retailer-product-991-card>' +
    '<customer-secret-name-card data-testid="price-value">PRIVATE_PERSONAL</customer-secret-name-card>' +
    '</retailer-product-card>'
  const full=proposeOfflineRetailerSelectors({html,origin})
  assert.ok(full.selectors.some(x=>x.selector.startsWith('retailer-product-991-card.')))
  const publicReport=summarizeOfflineSelectorProposals(full)
  assert.ok(publicReport.selectors.some(x=>x.selector==='retailer-product-card.product-card'))
  assert.ok(publicReport.selectors.some(x=>x.selector==='retailer-price-label[data-testid="price-value"]'))
  assert.doesNotMatch(JSON.stringify(publicReport),/retailer-product-991|customer-secret-name|PRIVATE_PRICE|PRIVATE_SKU|PRIVATE_PERSONAL/)
  assert.ok(publicReport.privateSelectorCount>=2)
  assert.equal(publicReport.readyForIngestion,false)
})

test('struck-through old shelf price is observed only as an offer hint, never a current-price selector',()=>{
  const html='<article class="product-card">' +
    '<del class="price-value" itemprop="price">PRIVATE_OLD_3.99</del>'+
    '<ins class="price-value" itemprop="price">PRIVATE_NEW_2.49</ins></article>'
  for(const [retailerId,url] of [
    ['plus','https://www.plus.nl/producten'],
    ['dekamarkt','https://www.dekamarkt.nl/aanbiedingen']]){
    const report=proposeOfflineRetailerSelectors({html,origin:{...origin,retailerId,url}})
    for(const selector of ['del.price-value','del[itemprop="price"]'])
      assert.equal(report.selectors.find(row=>row.selector===selector)?.field,'offer',retailerId+' '+selector)
    for(const selector of ['ins.price-value','ins[itemprop="price"]'])
      assert.equal(report.selectors.find(row=>row.selector===selector)?.field,'price',retailerId+' '+selector)
    assert.doesNotMatch(JSON.stringify(report),/PRIVATE_OLD|PRIVATE_NEW/)
    assert.equal(report.readyForIngestion,false)
  }
})

test('actual title/price tokens never create phantom product-container selectors',()=>{
  const html='<section class="product-card">'+
    '<span class="product-name" data-testid="product-title">PRIVATE_ITEM</span>'+
    '<span class="product-price" data-testid="product-price">PRIVATE_PRICE</span>'+
    '<span class="pack-size">PRIVATE_UNIT</span></section>'
  for(const [retailerId,url] of [
    ['plus','https://www.plus.nl/producten'],
    ['dekamarkt','https://www.dekamarkt.nl/aanbiedingen']]){
    const report=proposeOfflineRetailerSelectors({html,origin:{...origin,retailerId,url}})
    for(const [selector,field] of [
      ['span.product-name','name'],['span[data-testid="product-title"]','name'],
      ['span.product-price','price'],['span[data-testid="product-price"]','price'],
      ['section.product-card','product']]){
      assert.deepEqual(report.selectors.filter(row=>row.selector===selector).map(row=>row.field),[field],retailerId+' '+selector)
    }
    assert.equal(report.selectors.filter(row=>row.field==='product').length,1)
    assert.equal(report.readyForIngestion,false)
  }
})

test('HTML class or test-id named like JavaScript Object prototype cannot crash or invent source fields',()=>{
  const html='<section class="constructor toString hasOwnProperty product-card">'+
    '<span data-testid="constructor" class="product-name">PRIVATE_NAME</span>'+
    '<span data-testid="toString" class="price-value">PRIVATE_PRICE</span></section>'
  for(const [retailerId,url] of [
    ['plus','https://www.plus.nl/producten'],
    ['dekamarkt','https://www.dekamarkt.nl/aanbiedingen']]){
    const report=proposeOfflineRetailerSelectors({html,origin:{...origin,retailerId,url}})
    assert.ok(report.selectors.some(x=>x.selector==='section.product-card'&&x.field==='product'))
    assert.ok(report.selectors.some(x=>x.selector==='span.product-name'&&x.field==='name'))
    assert.ok(report.selectors.some(x=>x.selector==='span.price-value'&&x.field==='price'))
    assert.equal(report.selectors.some(x=>typeof x.field!=='string'),false)
    assert.equal(report.readyForIngestion,false)
    assert.doesNotMatch(JSON.stringify(report),/PRIVATE_NAME|PRIVATE_PRICE/)
  }
})

test('mixed old/current itemprop price elements cannot propose ambiguous CSS price selectors',()=>{
  for(const [retailerId,url] of [
    ['plus','https://www.plus.nl/producten'],
    ['dekamarkt','https://www.dekamarkt.nl/aanbiedingen']]){
    const html='<article class="product-card">'+
      '<span class="old-price price-value" data-testid="price-value" itemprop="price">PRIVATE_OLD_4.99</span>'+
      '<span class="product-price" itemprop="price">PRIVATE_NEW_2.49</span></article>'
    const result=proposeOfflineRetailerSelectors({html,origin:{...origin,retailerId,url}})
    assert.equal(result.selectors.some(x=>x.selector==='span[itemprop="price"]'),false,retailerId+' mixed microdata')
    assert.equal(result.selectors.some(x=>x.selector==='span.price-value'),false,retailerId+' mixed price class')
    assert.equal(result.selectors.some(x=>x.selector==='span[data-testid="price-value"]'),false,retailerId+' mixed test id')
    assert.deepEqual(result.selectors.filter(x=>x.selector==='span.old-price').map(x=>x.field),['offer'])
    assert.deepEqual(result.selectors.filter(x=>x.selector==='span.product-price').map(x=>x.field),['price'])
    assert.equal(result.readyForIngestion,false)
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE_OLD|PRIVATE_NEW/)
  }
})

test('DOM-decoded official Schema.org Product itemtype is consistent across signal and selector for both stores', () => {
  for (const [retailerId, url] of [
    ['plus','https://www.plus.nl/producten'],
    ['dekamarkt','https://www.dekamarkt.nl/producten'],
  ]) {
    const pageOrigin = { ...origin, retailerId, url }
    const source = '<section itemscope itemtype="https:&sol;&sol;schema.org&sol;Prod&#117;ct">' +
      '<span itemprop="name">SYNTHETIC_ITEM</span></section>'
    const report = proposeOfflineRetailerSelectors({html:source,origin:pageOrigin})
    assert.equal(report.structuredSignals.schemaOrgProduct,true,retailerId)
    assert.ok(report.selectors.some(x=>x.field==='product' &&
      x.selector==='section[itemtype="https://schema.org/Product"]'),retailerId)
    assert.equal(report.readyForIngestion,false)
    assert.equal(report.productionEnabled,false)
    const foreign = source.replace('schema.org','foreign.example')
    assert.equal(proposeOfflineRetailerSelectors({html:foreign,origin:pageOrigin})
      .structuredSignals.schemaOrgProduct,false)
    assert.equal(proposeOfflineRetailerSelectors({html:'<template>'+source+'</template>',origin:pageOrigin})
      .structuredSignals.schemaOrgProduct,false)
  }
})

test('unscoped JSON-LD Product words never forge official Schema.org product evidence',()=>{
  const pageOrigin={...origin}
  const sample=body=>'<script type="application/ld+json">'+JSON.stringify(body)+'</script>'
  for(const body of [
    {'@type':'Product',name:'SYNTHETIC'},
    {'@graph':[{'@type':'Product'}]},
    {'@context':'https://foreign.example','@type':'Product'},
    {'@context':'https://schema.org','@graph':[{'@context':'https://foreign.example','@type':'Product'}]},
  ]){
    const signals=proposeOfflineRetailerSelectors({html:sample(body),origin:pageOrigin}).structuredSignals
    assert.equal(signals.jsonLd,true)
    assert.equal(signals.schemaOrgProduct,false)
  }
  for(const body of [
    {'@type':'https://schema.org/Product'},
    {'@context':'https://schema.org','@graph':[{'@type':'Product'}]},
  ]){
    assert.equal(proposeOfflineRetailerSelectors({html:sample(body),origin:pageOrigin})
      .structuredSignals.schemaOrgProduct,true)
  }
})

test('nested HTML character references cannot invent source-observed Schema.org microdata selectors',()=>{
  for(const [retailerId,url] of [
    ['plus','https://www.plus.nl/producten'],
    ['dekamarkt','https://www.dekamarkt.nl/producten'],
  ]){
    const pageOrigin={...origin,retailerId,url}
    for(const encoded of [
      'https:&#38;sol;&#38;sol;schema.org&#38;sol;Product',
      'https:&amp;#47;&amp;#47;schema.org&amp;#47;Product',
      'https:&sol;&sol;schema.org&sol;Prod&amp;#117;ct',
    ]){
      const html='<section itemscope itemtype="'+encoded+'">SYNTHETIC</section>'
      const result=proposeOfflineRetailerSelectors({html,origin:pageOrigin})
      assert.equal(result.structuredSignals.schemaOrgProduct,false,retailerId+' '+encoded)
      assert.equal(result.selectors.some(x=>x.field==='product' &&
        x.selector==='section[itemtype="https://schema.org/Product"]'),false,retailerId+' '+encoded)
      assert.equal(result.productionEnabled,false)
    }
  }
})

test('offline selector and price provenance reject same-store HTML base rebasing and raw host aliases', () => {
  const html = href => '<html><head><base href="' + href + '"></head><body><a href="/product/synthetic-item">SYNTHETIC</a></body></html>'
  for (const href of [
    '/product/unreviewed-sku', '/producten?alternate=store', '/aanbiedingen/week/',
    '/producten/%2e%2e/producten', 'https://%77ww.plus.nl/producten',
    'https://www．plus.nl/producten', 'https:\t//www.plus.nl/producten',
  ]) {
    assert.throws(() => proposeOfflineRetailerSelectors({ html: html(href), origin }),
      /Untrusted HTML base URL/, JSON.stringify(href))
  }
  for (const href of ['https://%77ww.plus.nl/producten', '/producten/%2e%2e/producten',
                       'https:\t//www.plus.nl/producten']) {
    const markup = '<html><head><link rel="canonical" href="' + href + '"></head><body>SYNTHETIC</body></html>'
    assert.throws(() => proposeOfflineRetailerSelectors({ html: markup, origin }),
      /Untrusted HTML canonical source URL/, JSON.stringify(href))
  }
  const allowed = proposeOfflineRetailerSelectors({html:html('/'),origin})
  assert.equal(allowed.productionEnabled,false)
  assert.equal(allowed.permissionVerified,false)
})

test('leading whitespace before encoded source host cannot hide raw authority from offline replay', () => {
  const aliases=[' //%77ww.plus.nl/producten',' https://%77ww.plus.nl/producten',' //www.plus.nl/producten']
  for(const raw of aliases) {
    assert.equal(new URL(raw,origin.url).href,origin.url)
    for(const tag of ['base','link rel="canonical"']) {
      const html='<html><head><'+tag+' href="'+raw+'"></head><body><a href="/product/synthetic">SYNTHETIC</a></body></html>'
      assert.throws(()=>proposeOfflineRetailerSelectors({html,origin}),
        /Untrusted HTML (?:base|canonical)/,JSON.stringify(raw))
    }
  }
})

test('same-scheme single-slash aliases never replace an explicit retailer base or canonical URL',()=>{
  for(const href of ['https:/producten','https:producten']){
    assert.equal(new URL(href,origin.url).href,origin.url)
    for(const tag of ['base','link rel="canonical"']){
      const html='<html><head><'+tag+' href="'+href+'"></head><body><a href="/product/synthetic">SYNTHETIC</a></body></html>'
      assert.throws(()=>proposeOfflineRetailerSelectors({html,origin}),/Untrusted HTML/,href)
    }
  }
})

test('old-price ancestor may never count nested current-looking selectors as valid price', () => {
  for (const [retailerId,url] of [['plus','https://www.plus.nl/producten'],['dekamarkt','https://www.dekamarkt.nl/aanbiedingen']]) {
    const html='<article class="product-card"><div class="old-price"><span class="price-value" itemprop="price">PRIVATE_OLD</span></div>'+
      '<div class="current-price"><span class="price-value" itemprop="price">PRIVATE_CURRENT</span></div></article>'
    const report=proposeOfflineRetailerSelectors({html,origin:{...origin,retailerId,url}})
    assert.equal(report.selectors.some(x=>x.field==='price'&&x.selector==='span.price-value'),false,retailerId)
    assert.equal(report.selectors.some(x=>x.field==='price'&&x.selector==='span[itemprop="price"]'),false,retailerId)
    assert.ok(report.selectors.some(x=>x.field==='price'&&x.selector==='div.current-price'),retailerId)
    assert.equal(report.productionEnabled,false)
    assert.doesNotMatch(JSON.stringify(report),/PRIVATE_OLD|PRIVATE_CURRENT/)
  }
})


test('unmatched closing tags cannot escape an old-price wrapper and forge current price evidence', () => {
  const html='<div class="old-price"></unknown><span class="price-value" itemprop="price">PRIVATE_OLD</span></div>'+
    '<div class="current-price"><span class="price-value">PRIVATE_NEW</span></div>'
  const report=proposeOfflineRetailerSelectors({html,origin})
  assert.equal(report.selectors.some(x=>x.selector==='span.price-value'&&x.field==='price'),false)
  assert.equal(report.selectors.some(x=>x.selector==='span[itemprop="price"]'&&x.field==='price'),false)
  assert.ok(report.selectors.some(x=>x.selector==='div.current-price'&&x.field==='price'))
  assert.equal(report.productionEnabled,false)
})

test('exact UTC nanosecond-precision capture clocks preserve source evidence without changing its timestamp', () => {
  const capturedAt = '2026-10-04T12:00:00.123456789Z'
  const markup = '<article class="product-card"><span class="price-value">SYNTHETIC_CURRENT</span></article>'
  for (const [retailerId,url] of [['plus','https://www.plus.nl/producten'],['dekamarkt','https://www.dekamarkt.nl/aanbiedingen']]) {
    const report=proposeOfflineRetailerSelectors({html:markup,origin:{retailerId,url,capturedAt}})
    assert.equal(report.source.capturedAt,capturedAt)
    assert.ok(report.selectors.some(x=>x.selector==='span.price-value'&&x.field==='price'))
    assert.equal(report.productionEnabled,false)
  }
  for (const capturedAt of ['2026-02-30T12:00:00.123456789Z','2026-10-04T12:00:00.1234567890Z']) {
    assert.throws(()=>proposeOfflineRetailerSelectors({html:markup,origin:{...origin,capturedAt}}),/Invalid or oversized/)
  }
})

test('browser numeric references without semicolon agree across verified Schema Product signals and selector CSS', () => {
  const html='<section itemscope itemtype="https:&#47&#47schema.org&#47Product" class="product&#45card">'+
    '<span data-testid="price&#45value">SYNTHETIC</span></section>'
  for(const [retailerId,url] of [['plus','https://www.plus.nl/producten'],['dekamarkt','https://www.dekamarkt.nl/producten']]) {
    const report=proposeOfflineRetailerSelectors({html,origin:{...origin,retailerId,url}})
    assert.equal(report.structuredSignals.schemaOrgProduct,true,retailerId)
    assert.ok(report.selectors.some(x=>x.selector==='section[itemtype="https://schema.org/Product"]'&&x.field==='product'),retailerId)
    assert.ok(report.selectors.some(x=>x.selector==='section.product-card'),retailerId)
    assert.ok(report.selectors.some(x=>x.selector==='span[data-testid="price-value"]'&&x.field==='price'),retailerId)
    assert.equal(report.permissionVerified,false)
  }
})

test('one-pass HTML attribute reference decoder never splits oversized or nested numeric source evidence', async () => {
  const {decodeObservedHtmlAttribute}=await import('../scripts/retailer-html-attribute-references.mjs')
  for(const [raw,expected] of [
    ['&#47','/'],['&#x2f','/'],['&#x2F;','/'],
    ['&#38;sol;','&sol;'],['&amp;#47;','&#47;'],
    ['&#12345678;', '&#12345678;'],['&#x1234567;', '&#x1234567;'],
    ['&#0;', '&#0;'],['&#xD800;', '&#xD800;'],
  ])assert.equal(decodeObservedHtmlAttribute(raw),expected,raw)
})
