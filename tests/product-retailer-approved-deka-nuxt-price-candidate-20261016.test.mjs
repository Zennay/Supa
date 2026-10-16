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
