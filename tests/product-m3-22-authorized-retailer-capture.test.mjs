import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalM3RetailerRequirements } from '../scripts/retailer-canonical-m3-demand.mjs'
import {
  captureAuthorizedM3RetailerBasket, validateM3RetailerCapturePlan,
} from '../scripts/retailer-m3-authorized-22-capture.mjs'

const NOW = Date.parse('2026-10-15T10:00:00.000Z')
const DEMAND = canonicalM3RetailerRequirements()
const RIGHTS = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-14',
  sources: ['plus', 'dekamarkt'].map((supermarket) => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [{ kind: 'written_permission',
      url: 'https://example.org/fictional-transport-test-only',
      finding: 'Synthetic in-memory test permission: NOT retailer authorization' }],
  })),
}

function plan() {
  return {
    version: 1,
    products: ['plus', 'dekamarkt'].flatMap((store) =>
      DEMAND.map((line, index) => ({
        supermarket: store, ingredientId: line.id,
        url: store === 'plus'
          ? 'https://www.plus.nl/product/synthetic-test-' + index
          : 'https://www.dekamarkt.nl/producten/synthetic-test-' + index,
      }))),
  }
}

function htmlFor(line, index, shop, price, availability = 'https://schema.org/InStock') {
  return '<script type="application/ld+json">' + JSON.stringify({
    '@type': 'Product', sku: 'synthetic-product-' + index,
    name: line.query,
    weight: { value: line.unit === 'piece' ? '1 stuk' :
      '1000 ' + line.unit },
    offers: { '@type': 'Offer', price: String(price),
      priceCurrency: 'EUR', availability },
  }) + '</script>'
}

function mockedTransport({ status = 200, badAvailability = false, oversized = false } = {}) {
  const urls = plan().products
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    const found = urls.find((row) => row.url === url)
    assert.ok(found, 'only operator-specified URLs')
    const index = DEMAND.findIndex((line) => line.id === found.ingredientId)
    const bytes = new TextEncoder().encode(oversized ? 'x'.repeat(2 * 1024 * 1024 + 1) :
      htmlFor(DEMAND[index], index, found.supermarket,
        found.supermarket === 'plus' ? '1.50' : '1.25',
        badAvailability && found.supermarket === 'dekamarkt' && index === 4
          ? 'https://schema.org/PreOrder' : 'https://schema.org/InStock'))
    return {
      url, ok: status === 200, status,
      headers: { get: (name) => name === 'content-type' ? 'text/html' : null },
      body: new ReadableStream({
        start(controller) { controller.enqueue(bytes); controller.close() },
      }),
    }
  }
  return { fetchImpl, calls }
}

test('preflights exactly 11 assignments at each retailer before any capture', () => {
  const valid = plan()
  const checked = validateM3RetailerCapturePlan(valid)
  assert.equal(checked.requirements.length, 11)
  assert.equal(checked.sources.length, 22)
  assert.deepEqual(new Set(checked.sources.map(item => item.supermarket)),
    new Set(['plus', 'dekamarkt']))
  const missing = structuredClone(valid)
  missing.products.pop()
  assert.throws(() => validateM3RetailerCapturePlan(missing), /exactly 11/)
  const duplicate = structuredClone(valid)
  duplicate.products[1].ingredientId = duplicate.products[0].ingredientId
  assert.throws(() => validateM3RetailerCapturePlan(duplicate), /Duplicate/)
  const unsafe = structuredClone(valid)
  unsafe.products[0].url = 'https://www.plus.nl.evil.example/product/test'
  assert.throws(() => validateM3RetailerCapturePlan(unsafe), /Invalid/)
  unsafe.products[0].url = 'https://www.plus.nl/product/test?user=private'
  assert.throws(() => validateM3RetailerCapturePlan(unsafe), /Invalid/)
})

test('full synthetic 11+11 captured HTML flows to ONE physical basket comparison', async () => {
  const transport = mockedTransport()
  const result = await captureAuthorizedM3RetailerBasket({
    plan: plan(), enableLive: true, permissionDocument: RIGHTS,
    fetchImpl: transport.fetchImpl, nowMs: NOW,
  })
  assert.equal(transport.calls.length, 22)
  for (const call of transport.calls) {
    assert.equal(call.options.redirect, 'error')
    assert.equal(call.options.credentials, 'omit')
  }
  assert.equal(result.requiredIngredientCount, 11)
  assert.equal(result.capturedSourceCount, 22)
  assert.equal(result.captureSummary.length, 22)
  assert.ok(result.captureSummary.every(item => item.parsedProducts === 1))
  assert.equal(result.comparison.lines.length, 11)
  assert.equal(result.comparison.comparable, true)
  assert.equal(result.comparison.cheaperStore, 'dekamarkt')
  assert.ok(result.comparison.savingsCents > 0)
  assert.equal(result.provenance, 'synthetic-test-transport-preview')
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.claimable, false)
  assert.match(result.warning, /not independently verified/)
})

test('unknown stock in one of 22 lines withdraws entire money comparison', async () => {
  const transport = mockedTransport({ badAvailability: true })
  const result = await captureAuthorizedM3RetailerBasket({
    plan: plan(), enableLive: true, permissionDocument: RIGHTS,
    fetchImpl: transport.fetchImpl, nowMs: NOW,
  })
  assert.equal(result.comparison.comparable, false)
  assert.equal(result.comparison.savingsCents, null)
  assert.equal(result.comparison.cheaperStore, null)
  assert.equal(result.claimable, false)
})

test('default disabled, source rights not granted and invalid assignments make zero HTTP requests', async () => {
  const transport = mockedTransport()
  const p = plan()
  await assert.rejects(captureAuthorizedM3RetailerBasket({
    plan: p, fetchImpl: transport.fetchImpl,
    permissionDocument: RIGHTS, nowMs: NOW,
  }), /disabled/)
  const denied = structuredClone(RIGHTS)
  denied.sources[0].permissionStatus = 'permission_required'
  denied.sources[0].productionEnabled = false
  await assert.rejects(captureAuthorizedM3RetailerBasket({
    plan: p, enableLive: true, fetchImpl: transport.fetchImpl,
    permissionDocument: denied, nowMs: NOW,
  }), /permission/)
  const bad = plan()
  bad.products[5].url = 'https://www.dekamarkt.nl/producten/foreign-host'
  await assert.rejects(captureAuthorizedM3RetailerBasket({
    plan: bad, enableLive: true, fetchImpl: transport.fetchImpl,
    permissionDocument: RIGHTS, nowMs: NOW,
  }), /Invalid/)
  assert.equal(transport.calls.length, 0)
})

test('rate-limit refusal stops instantly without proxy, retry or fallback requests', async () => {
  const transport = mockedTransport({ status: 429 })
  await assert.rejects(captureAuthorizedM3RetailerBasket({
    plan: plan(), enableLive: true, permissionDocument: RIGHTS,
    fetchImpl: transport.fetchImpl, nowMs: NOW,
  }), /response refused/)
  assert.equal(transport.calls.length, 1)
})

test('oversized streamed HTML is rejected on the first source and not published', async () => {
  const transport = mockedTransport({ oversized: true })
  await assert.rejects(captureAuthorizedM3RetailerBasket({
    plan: plan(), enableLive: true, permissionDocument: RIGHTS,
    fetchImpl: transport.fetchImpl, nowMs: NOW,
  }), /byte limit/)
  assert.equal(transport.calls.length, 1)
})

test('shared physical product URLs are fetched once rather than priced repeatedly', async () => {
  const p = plan()
  // A shared physical SKU can fulfill two requirements. It is one source.
  p.products[1].url = p.products[0].url
  const checked = validateM3RetailerCapturePlan(p)
  assert.equal(checked.sources.length, 21)
  const transport = mockedTransport()
  // The mocked transport uses original URLs; this validates fetch count and
  // conservative unknown result, not fabricated cross-ingredient coverage.
  const result = await captureAuthorizedM3RetailerBasket({
    plan: p, enableLive: true, permissionDocument: RIGHTS,
    fetchImpl: transport.fetchImpl, nowMs: NOW,
  })
  assert.equal(result.captureSummary.length, 21)
  assert.equal(transport.calls.length, 21)
  assert.equal(result.claimable, false)
})
