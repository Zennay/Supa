import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { captureApprovedProductPriceCandidate } from
  '../scripts/retailer-approved-html-product-price-candidate.mjs'

// Synthetic authorizations exist ONLY inside tests. No retailer is contacted.
const capturedAt = new Date(Date.now() - 30_000).toISOString()
const gate = () => ({
  version: 1,
  milestone: 'M1 Data Feasibility',
  reviewedAt: '2026-10-16',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven',
    permissionStatus: 'permitted', productionEnabled: true,
    evidence: [{
      kind: 'written_permission',
      url: 'https://example.test/fictional-not-real-grant',
      finding: 'SYNTHETIC TEST. No actual retailer permission.',
    }],
  })),
})
const urls = {
  plus: 'https://www.plus.nl/product/fictional-milk-123',
  dekamarkt: 'https://www.dekamarkt.nl/producten/fictional-milk/456',
}
function consent(supermarket, sourceUrl) {
  return {
    supermarket, kind: 'product', sourceUrl,
    reviewed: true, termsReviewed: true,
    robotsReviewed: true, noAntiBotBypass: true,
  }
}
function product(supermarket, price = '2.49', weight = '500 g', stock = 'InStock') {
  return {
    '@context': 'https://schema.org', '@type': 'Product',
    url: urls[supermarket], sku: 'FICTIONAL-123',
    name: 'Only a fictional test product',
    weight: { value: weight },
    offers: {
      '@type': 'Offer', price, priceCurrency: 'EUR',
      availability: 'https://schema.org/' + stock,
    },
  }
}
function html(...records) {
  return '<!doctype html><html><head>' +
    records.map(record => '<script type="application/ld+json">' +
      JSON.stringify(record) + '</script>').join('') +
    '</head><body>Fictional.</body></html>'
}
function options(supermarket, markup, overrides = {}) {
  const url = urls[supermarket]
  return {
    source: { supermarket, kind: 'product', url },
    permissionGate: gate(), grant: consent(supermarket, url),
    capturedAt,
    fetchFn: async () => new Response(markup, {
      status: 200, headers: { 'content-type': 'text/html;charset=utf-8' },
    }),
    ...overrides,
  }
}

test('PLUS: one approved in-memory HTML response becomes a hash-pinned 249-cent 500g private candidate', async () => {
  const input = html(product('plus'))
  let calls = 0
  const cfg = options('plus', input)
  cfg.fetchFn = async (url, request) => {
    calls++
    assert.equal(url, urls.plus)
    assert.equal(request.redirect, 'error')
    assert.equal(request.credentials, 'omit')
    return new Response(input, { status: 200, headers: { 'content-type': 'text/html' } })
  }
  const result = await captureApprovedProductPriceCandidate(cfg)
  assert.equal(calls, 1)
  assert.equal(result.status, 'candidate_needs_review')
  assert.equal(result.observation.currentPriceCents, 249)
  assert.equal(result.observation.pack.amount, 500)
  assert.equal(result.observation.pack.unit, 'g')
  assert.equal(result.observation.availability, 'available')
  assert.equal(result.observation.provenance.url, urls.plus)
  assert.equal(result.source.sha256, createHash('sha256').update(input).digest('hex'))
  assert.deepEqual(result.observation.provenance.sha256, result.source.sha256)
  assert.equal(result.humanReviewRequired, true)
  assert.equal(result.verifiedCurrentCheckoutPrice, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.published, false)
  assert.equal(result.productionEnabled, false)
})

test('Deka: a structured Product with real price and physical pack uses same normalized contract', async () => {
  const result = await captureApprovedProductPriceCandidate(
    options('dekamarkt', html(product('dekamarkt', '3.25', '750 ml'))))
  assert.equal(result.status, 'candidate_needs_review')
  assert.equal(result.observation.currentPriceCents, 325)
  assert.equal(result.observation.pack.amount, 750)
  assert.equal(result.observation.pack.unit, 'ml')
  assert.equal(result.observation.supermarket, 'dekamarkt')
})

test('existing Deka SSR pages with uppercase Price or missing pack do NOT become invented live prices', async () => {
  const original = product('dekamarkt')
  delete original.offers.price
  original.offers.Price = 0.85
  let result = await captureApprovedProductPriceCandidate(options('dekamarkt', html(original)))
  assert.equal(result.status, 'review_required')
  assert.equal(result.reason, 'price_or_physical_pack_missing')
  assert.equal(result.observation, null)
  result = await captureApprovedProductPriceCandidate(
    options('plus', html(product('plus', '1.25', 'unverified pack'))))
  assert.equal(result.reason, 'price_or_physical_pack_missing')
})

test('mixed JSON-LD blocks select exact Product URL, never cheapest related product', async () => {
  const related = product('plus', '0.01')
  related.url = 'https://www.plus.nl/product/other-456'
  const result = await captureApprovedProductPriceCandidate(
    options('plus', html({ '@type': 'WebSite' }, related, product('plus', '4.29'))))
  assert.equal(result.status, 'candidate_needs_review')
  assert.equal(result.observation.currentPriceCents, 429)
})

test('two products matching same URL, malformed JSON-LD and mismatched page URL refuse', async () => {
  for (const markup of [
    html(product('plus', '1.00'), product('plus', '0.01')),
    '<script type="application/ld+json">{broken</script>' + html(product('plus')),
    html({ ...product('plus'), url: 'https://www.plus.nl/product/wrong-99' }),
  ]) {
    const result = await captureApprovedProductPriceCandidate(options('plus', markup))
    assert.equal(result.status, 'review_required')
    assert.equal(result.observation, null)
    assert.equal(result.publicSavingsClaimEligible, false)
  }
})

test('out-of-stock products and unknown availability cannot be sold as purchasable', async () => {
  for (const state of ['OutOfStock', 'PreOrder']) {
    const result = await captureApprovedProductPriceCandidate(options('plus', html(product('plus', '2.49', '500 g', state))))
    assert.equal(result.reason, 'availability_unverified')
    assert.equal(result.observation, null)
  }
})

test('stale captured HTML cannot be promoted even if it has a valid hash and price', async () => {
  const result = await captureApprovedProductPriceCandidate(options(
    'plus', html(product('plus')), { capturedAt: '2026-01-01T12:00:00.000Z' }))
  assert.equal(result.reason, 'stale_or_invalid_capture_clock')
  assert.equal(result.observation, null)
})

test('actual repository permissions block both stores BEFORE injected transport', async () => {
  const real = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
  let networkCalls = 0
  for (const supermarket of ['plus', 'dekamarkt']) {
    await assert.rejects(captureApprovedProductPriceCandidate(options(
      supermarket, html(product(supermarket)), {
        permissionGate: real,
        fetchFn: async () => { networkCalls++; throw Error('NO NETWORK') },
      })), /Explicit retailer source permission required/)
  }
  assert.equal(networkCalls, 0)
})

test('missing grant, 403, 429 and non-HTML are fail-closed; no retries', async () => {
  let calls = 0
  await assert.rejects(captureApprovedProductPriceCandidate(options(
    'plus', html(product('plus')), {
      grant: { ...consent('plus', urls.plus), reviewed: false },
      fetchFn: async () => { calls++; return new Response('DENIED') },
    })), /Approved one-URL capture scope required/)
  assert.equal(calls, 0)
  for (const status of [403, 429]) {
    await assert.rejects(captureApprovedProductPriceCandidate(options(
      'plus', html(product('plus')), {
        fetchFn: async () => { calls++; return new Response('', { status }) },
      })), /refused or rate-limited/)
  }
  assert.equal(calls, 2)
  await assert.rejects(captureApprovedProductPriceCandidate(options(
    'plus', html(product('plus')), {
      fetchFn: async () => { calls++; return new Response('{}', {
        status: 200, headers: { 'content-type': 'application/json' },
      }) },
    })), /did not return HTML/)
  assert.equal(calls, 3)
})

test('unapproved host never reaches external transport', async () => {
  let calls = 0
  await assert.rejects(captureApprovedProductPriceCandidate(options('plus', html(product('plus')), {
    source: { supermarket: 'plus', kind: 'product', url: 'https://private.invalid/product/foo' },
    fetchFn: async () => { calls++; throw Error('NO NETWORK') },
  })), /outside exact approved HTTPS route/)
  assert.equal(calls, 0)
})

test('synthetic approved PLUS price cannot cross a foreign canonical/base HTML source origin', async () => {
  const normal=html(product('plus'))
  for (const extra of [
    '<link rel="canonical" href="https://foreign.example/product/fictional-123">',
    '<base href="//www.dekamarkt.nl/">',
    '<link rel="canonical" href="http://www.plus.nl/product/fictional-123">',
  ]) {
    const markup=normal.replace('<head>','<head>'+extra)
    const result=await captureApprovedProductPriceCandidate(options('plus',markup))
    assert.equal(result.status,'review_required')
    assert.equal(result.reason,'missing_or_invalid_jsonld')
    assert.equal(result.observation,null)
    assert.equal(result.published,false)
  }
  for (const extra of [
    '<link rel="canonical" href="https://www.plus.nl/product/fictional-milk-123">',
    '<base href="https://www.plus.nl/">',
  ]) {
    const result=await captureApprovedProductPriceCandidate(options('plus',
      normal.replace('<head>','<head>'+extra)))
    assert.equal(result.status,'candidate_needs_review')
    assert.equal(result.observation.currentPriceCents,249)
    assert.equal(result.verifiedCurrentCheckoutPrice,false)
  }
})
