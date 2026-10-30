import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { captureApprovedProductPriceCandidate } from
  '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Existing historical reviewed M1 fixture supplies only the OFFLINE structure;
// HTML is synthetically assembled in memory to test the new bridge.
// A test using these bytes is never a new live retailer price observation.
const fixture = JSON.parse(await readFile(
  new URL('../fixtures/m1/dekamarkt-product-halfvolle-melk.v1.json', import.meta.url),
  'utf8'))
const url = fixture.source.url
const time = new Date(Date.now() - 30_000).toISOString()
const gate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven',
    permissionStatus: 'permitted', productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.test/fictional-not-real-permission',
      finding: 'Only a mock unit test. No retailer permission actually granted.' }],
  })),
}
function html(nuxt = fixture.nuxtPayload, ld = fixture.jsonLdProduct) {
  return '<!doctype html><html><head><script id="__NUXT_DATA__">' +
    JSON.stringify(nuxt) + '</script>' +
    '<script type="application/ld+json">' + JSON.stringify(ld) +
    '</script></head><body>Offline mock</body></html>'
}
function options(markup) {
  return {
    source: { supermarket: 'dekamarkt', kind: 'product', url },
    permissionGate: gate,
    grant: {
      supermarket: 'dekamarkt', kind: 'product', sourceUrl: url,
      reviewed: true, termsReviewed: true, robotsReviewed: true,
      noAntiBotBypass: true,
    },
    capturedAt: time,
    fetchFn: async () => new Response(markup, {
      status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  }
}

test('historical Deka SSR Nuxt shape now produces independently corroborated 85-cent PRIVATE candidate', async () => {
  const result = await captureApprovedProductPriceCandidate(options(html()))
  assert.equal(result.status, 'candidate_needs_review')
  assert.equal(result.observation.currentPriceCents, 85)
  assert.equal(result.observation.sourceProductId, '115873')
  assert.equal(result.observation.name, 'Zuivelmeester Halfvolle melk')
  assert.ok(result.observation.pack.amount > 0)
  assert.notEqual(result.observation.pack.unit, 'unknown')
  assert.equal(result.observation.availability, 'available')
  assert.equal(result.observation.provenance.url, url)
  assert.equal(result.observation.provenance.sha256, result.source.sha256)
  assert.equal(result.humanReviewRequired, true)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
  assert.equal(result.published, false)
  assert.equal(result.productionEnabled, false)
})

test('Deka Nuxt price conflict with same-page JSON-LD refuses rather than choosing cheaper number', async () => {
  const forged = structuredClone(fixture.nuxtPayload)
  forged[11] = 0.01
  const result = await captureApprovedProductPriceCandidate(options(html(forged)))
  assert.equal(result.status, 'review_required')
  assert.equal(result.observation, null)
})

test('Deka Nuxt product ID must match both its own page URL and structured JSON-LD mpn', async () => {
  const forged = structuredClone(fixture.nuxtPayload)
  forged[5] = 999999
  const result = await captureApprovedProductPriceCandidate(options(html(forged)))
  assert.equal(result.status, 'review_required')
  assert.equal(result.observation, null)
})

test('Nuxt is not trusted if JSON-LD URL is changed to a different product', async () => {
  const ld = structuredClone(fixture.jsonLdProduct)
  ld.offers.url = 'https://www.dekamarkt.nl/producten/other-product/999'
  const result = await captureApprovedProductPriceCandidate(options(html(undefined, ld)))
  assert.equal(result.status, 'review_required')
  assert.equal(result.observation, null)
})

test('duplicate Nuxt scripts and missing structured evidence are not trusted', async () => {
  const duplicate = html() + '<script id="__NUXT_DATA__">' +
    JSON.stringify(fixture.nuxtPayload) + '</script>'
  for (const markup of [duplicate, html(fixture.nuxtPayload, { '@type': 'WebSite' })]) {
    const result = await captureApprovedProductPriceCandidate(options(markup))
    assert.equal(result.status, 'review_required')
    assert.equal(result.observation, null)
  }
})

test('Deka real checked-in source grant still refuses network; tests do not authorize scrapes', async () => {
  const real = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url),
    'utf8'))
  let calls = 0
  await assert.rejects(captureApprovedProductPriceCandidate({
    ...options(html()), permissionGate: real,
    fetchFn: async () => { calls++; throw Error('not permitted') },
  }), /Explicit retailer source permission required/)
  assert.equal(calls, 0)
})

test('Deka source refuses a lower-case Offer.price that contradicts Nuxt and capital Price', async () => {
  const ld = structuredClone(fixture.jsonLdProduct)
  ld.weight = { value: '1 liter' }
  ld.offers.price = '0.01'
  const result = await captureApprovedProductPriceCandidate(options(html(undefined, ld)))
  assert.equal(result.status, 'review_required')
  assert.equal(result.observation, null)
})

test('Deka source refuses injected lower-case priceSpecification conflict on trusted Nuxt page', async () => {
  const ld = structuredClone(fixture.jsonLdProduct)
  ld.offers.priceSpecification = { '@type': 'UnitPriceSpecification', price: '0.01', priceCurrency: 'EUR' }
  const result = await captureApprovedProductPriceCandidate(options(html(undefined, ld)))
  assert.equal(result.status, 'review_required')
  assert.equal(result.observation, null)
})

test('fully parseable lower-case JSON-LD must not bypass conflicting Deka Nuxt checkout evidence', async () => {
  const ld = structuredClone(fixture.jsonLdProduct)
  ld.weight = { value: '1 liter' }
  ld.offers.Price = 0.99
  ld.offers.price = '0.99'
  const result = await captureApprovedProductPriceCandidate(options(html(undefined, ld)))
  assert.equal(result.status, 'review_required')
  assert.equal(result.observation, null)
})

test('fully parseable JSON-LD with wrong product identity cannot bypass Deka Nuxt', async () => {
  const ld = structuredClone(fixture.jsonLdProduct)
  ld.weight = { value: '1 liter' }
  ld.offers.price = '0.85'
  ld.mpn = 999999
  const result = await captureApprovedProductPriceCandidate(options(html(undefined, ld)))
  assert.equal(result.status, 'review_required')
  assert.equal(result.observation, null)
})

test('matching complete Deka JSON-LD and Nuxt retain only corroborated private price', async () => {
  const ld = structuredClone(fixture.jsonLdProduct)
  ld.weight = { value: '1 liter' }
  ld.offers.price = '0.85'
  const result = await captureApprovedProductPriceCandidate(options(html(undefined, ld)))
  assert.equal(result.status, 'candidate_needs_review')
  assert.equal(result.observation.currentPriceCents, 85)
  assert.equal(result.observation.pack.amount, 1)
  assert.equal(result.observation.pack.unit, 'l')
  assert.equal(result.observation.sourceProductId, '115873')
  assert.equal(result.observation.offer, null)
  assert.equal(result.published, false)
})

test('complete schema pack/stock must corroborate Deka Nuxt and cannot silently override it', async () => {
  const ld = structuredClone(fixture.jsonLdProduct)
  ld.offers.price = '0.85'
  ld.weight = { value: '500 ml' }
  const pack = await captureApprovedProductPriceCandidate(options(html(undefined, ld)))
  assert.equal(pack.status, 'review_required')
  assert.equal(pack.observation, null)

  const stock = structuredClone(fixture.jsonLdProduct)
  stock.offers.price = '0.85'
  stock.weight = { value: '1 liter' }
  stock.offers.availability = 'https://schema.org/OutOfStock'
  const result = await captureApprovedProductPriceCandidate(options(html(undefined, stock)))
  assert.equal(result.status, 'review_required')
  assert.equal(result.observation, null)
})

test('Deka rejects case-variant stock and price-spec evidence that conflicts with Nuxt', async () => {
  const mismatch = structuredClone(fixture.jsonLdProduct)
  mismatch.offers.Availability = 'https://schema.org/OutOfStock'
  const stock = await captureApprovedProductPriceCandidate(options(html(undefined, mismatch)))
  assert.equal(stock.status, 'review_required')
  assert.equal(stock.observation, null)

  const spec = structuredClone(fixture.jsonLdProduct)
  spec.offers.PriceSpecification = { price: '0.01', priceCurrency: 'EUR' }
  const extra = await captureApprovedProductPriceCandidate(options(html(undefined, spec)))
  assert.equal(extra.status, 'review_required')
  assert.equal(extra.observation, null)
})

test('Deka matches physically identical 1000 ml and 1 liter when both price spellings corroborate Nuxt', async () => {
  const ld = structuredClone(fixture.jsonLdProduct)
  ld.url = url
  ld.sku = '115873'
  ld.weight = { value: '1000 ml' }
  ld.offers.price = '0.85'
  ld.offers.Price = 0.85
  const result = await captureApprovedProductPriceCandidate(options(html(undefined,ld)))
  assert.equal(result.status,'candidate_needs_review')
  assert.equal(result.observation.currentPriceCents,85)
  assert.equal(result.publicSavingsClaimEligible,false)
  assert.equal(result.published,false)
  ld.weight = {value:'750 ml'}
  const mismatch = await captureApprovedProductPriceCandidate(options(html(undefined,ld)))
  assert.equal(mismatch.status,'review_required')
  assert.equal(mismatch.observation,null)
  ld.weight = {value:'1 kg'}
  const wrongDimension = await captureApprovedProductPriceCandidate(options(html(undefined,ld)))
  assert.equal(wrongDimension.status,'review_required')
  assert.equal(wrongDimension.observation,null)
})

test('Deka Nuxt and JSON-LD cannot agree their way around a foreign canonical/base source',async()=>{
  const original=html()
  for (const meta of [
    '<link rel="canonical" href="https://www.plus.nl/product/fictional-123">',
    '<base href="https://foreign.example/">',
    '<link rel="canonical" href="http://www.dekamarkt.nl/producten/">',
  ]) {
    // Source identity is now checked at transport, before price candidates.
    await assert.rejects(captureApprovedProductPriceCandidate(options(
      original.replace('<head>','<head>'+meta))),
      /Untrusted HTML (canonical source URL|base URL)/)
  }
  const correct=original.replace('<head>',
    '<head><link rel="canonical" href="'+url+'">')
  const valid=await captureApprovedProductPriceCandidate(options(correct))
  assert.equal(valid.status,'candidate_needs_review')
  assert.equal(valid.observation.currentPriceCents,85)
  assert.equal(valid.verifiedCurrentCheckoutPrice,false)
})

test('direct Deka fallback refuses caller JSON-LD substituted for different captured HTML', async () => {
  const { parseDekaNuxtFromAuthorizedHtml } = await import('../scripts/retailer-approved-deka-nuxt-product.mjs')
  const { createHash } = await import('node:crypto')
  const honest = html()
  const altered = structuredClone(fixture.jsonLdProduct)
  altered.offers.Price = 0.01
  const forgedPage = html(fixture.nuxtPayload, altered)
  const source = body => ({supermarket:'dekamarkt',kind:'product',url,
    capturedAt:time,sha256:createHash('sha256').update(body).digest('hex')})
  const positive = parseDekaNuxtFromAuthorizedHtml({html:honest,provenance:source(honest),jsonLdBlocks:[fixture.jsonLdProduct]})
  assert.equal(positive.type,'observation')
  const swapped = parseDekaNuxtFromAuthorizedHtml({html:forgedPage,provenance:source(forgedPage),jsonLdBlocks:[fixture.jsonLdProduct]})
  assert.equal(swapped.type,'abstain')
  const wrongHash = parseDekaNuxtFromAuthorizedHtml({html:honest,provenance:{...source(honest),sha256:'0'.repeat(64)},jsonLdBlocks:[fixture.jsonLdProduct]})
  assert.equal(wrongHash.type,'abstain')
})

test('direct Deka corroboration does not trust a caller that hides present Nuxt evidence', async () => {
  const { corroborateDekaNuxtProduct, parseDekaNuxtFromAuthorizedHtml } =
    await import('../scripts/retailer-approved-deka-nuxt-product.mjs')
  const { createHash } = await import('node:crypto')
  const page = html()
  const provenance = {supermarket:'dekamarkt',kind:'product',url,
    capturedAt:time,sha256:createHash('sha256').update(page).digest('hex')}
  const structured=parseDekaNuxtFromAuthorizedHtml({html:page,provenance,jsonLdBlocks:[fixture.jsonLdProduct]})
  assert.equal(structured.type,'observation')
  const result=corroborateDekaNuxtProduct({html:page,provenance,
    jsonLdBlocks:[fixture.jsonLdProduct],structured,nuxtPresent:false})
  assert.equal(result.type,'abstain')
})

test('standalone Deka HTML fallback refuses impossible and future source capture clocks', async () => {
  const { parseDekaNuxtFromAuthorizedHtml } = await import('../scripts/retailer-approved-deka-nuxt-product.mjs')
  const { createHash } = await import('node:crypto')
  const page=html()
  const baseline={supermarket:'dekamarkt',kind:'product',url,
    capturedAt:time,sha256:createHash('sha256').update(page).digest('hex')}
  for(const capturedAt of [
    '2026-02-30T12:00:00Z','2025-02-29T12:00:00Z',
    '2035-01-01T12:00:00Z','2026-10-30T25:00:00Z',
  ]) {
    const parsed=parseDekaNuxtFromAuthorizedHtml({html:page,
      provenance:{...baseline,capturedAt},jsonLdBlocks:[fixture.jsonLdProduct]})
    assert.equal(parsed.type,'abstain',capturedAt)
  }
})

test('Deka Nuxt fallback refuses a second nested graph Product contradicting the source price', async () => {
  const competing={ '@context':'https://schema.org', '@graph': [{
    '@type':'Product',name:'Zuivelmeester Halfvolle melk',mpn:'115873',
    offers:{'@type':'Offer',Price:0.01,priceCurrency:'EUR',
      availability:'https://schema.org/InStock'},
  }] }
  const extra='<script type="application/ld+json">'+JSON.stringify(competing)+'</script>'
  const sourcePage=html().replace('</head>',extra+'</head>')
  const result=await captureApprovedProductPriceCandidate(options(sourcePage))
  assert.equal(result.status,'review_required')
  assert.equal(result.observation,null)
})

test('direct Deka corroboration without Nuxt cannot publish caller-forged structured prices', async () => {
  const { corroborateDekaNuxtProduct, parseDekaNuxtFromAuthorizedHtml } =
    await import('../scripts/retailer-approved-deka-nuxt-product.mjs')
  const { createHash } = await import('node:crypto')
  const realPage=html()
  const source=page=>({supermarket:'dekamarkt',kind:'product',url,
    capturedAt:time,sha256:createHash('sha256').update(page).digest('hex')})
  const valid=parseDekaNuxtFromAuthorizedHtml({html:realPage,
    provenance:source(realPage),jsonLdBlocks:[fixture.jsonLdProduct]})
  assert.equal(valid.type,'observation')
  const withoutNuxt=realPage.replace('<script id="__NUXT_DATA__">'+
    JSON.stringify(fixture.nuxtPayload)+'</script>','')
  assert.notEqual(withoutNuxt,realPage)
  const claimed={...valid,observation:{...valid.observation,currentPriceCents:1}}
  const result=corroborateDekaNuxtProduct({html:withoutNuxt,
    provenance:source(withoutNuxt),jsonLdBlocks:[fixture.jsonLdProduct],
    structured:claimed,nuxtPresent:false})
  assert.notEqual(result.observation?.currentPriceCents,1)
})
