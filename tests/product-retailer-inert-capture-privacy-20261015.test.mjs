import assert from 'node:assert/strict'
import test from 'node:test'
import { captureToPrivateSelectorReview } from '../scripts/retailer-approved-capture-selector-bridge.mjs'

const plus = 'https://www.plus.nl/producten'
const at = '2026-10-14T12:00:00.000Z'
const fictionalGate = () => ({
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-14',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true, evidence: [{ kind: 'written_permission',
      url: 'https://example.test/fictional-authorization', finding: 'FAKE CI ONLY' }],
  })),
})
const grant = () => ({
  supermarket: 'plus', kind: 'catalog', sourceUrl: plus,
  reviewed: true, termsReviewed: true, robotsReviewed: true,
  noAntiBotBypass: true,
})
const base = () => ({
  source: { supermarket: 'plus', kind: 'catalog', url: plus },
  permissionGate: fictionalGate(), grant: grant(), capturedAt: at,
})
const fake = (html, count) => async () => {
  count.calls++
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
}

test('product: nested and direct authorization accessors refuse before getter and transport', async () => {
  for (const tamper of [
    o => Object.defineProperty(o.grant, 'reviewed', { get() { throw Error('GETTER_RAN') } }),
    o => Object.defineProperty(o.permissionGate.sources[0], 'productionEnabled', { get() { throw Error('GETTER_RAN') } }),
    o => Object.defineProperty(o.permissionGate.sources[0].evidence[0], 'kind', { get() { throw Error('GETTER_RAN') } }),
    o => Object.defineProperty(o.source, 'url', { get() { throw Error('GETTER_RAN') } }),
    o => Object.defineProperty(o, 'grant', { get() { throw Error('GETTER_RAN') } }),
  ]) {
    const opts = base(), count = { calls: 0 }
    opts.fetchFn = fake('<article class="product-card">Mock</article>', count)
    tamper(opts)
    await assert.rejects(() => captureToPrivateSelectorReview(opts),
      err => !String(err).includes('GETTER_RAN'))
    assert.equal(count.calls, 0)
  }
})

test('product: nested Proxy and sparse source evidence refuse before injected HTTP capability', async () => {
  for (const tamper of [
    o => { o.grant = new Proxy(o.grant, {}) },
    o => { o.permissionGate.sources[0].evidence[0] =
      new Proxy(o.permissionGate.sources[0].evidence[0], {}) },
    o => { o.permissionGate.sources = new Array(2); o.permissionGate.sources[0] =
      fictionalGate().sources[0] },
  ]) {
    const opts = base(), count = { calls: 0 }
    opts.fetchFn = fake('<article class="product-card">Mock</article>', count)
    tamper(opts)
    await assert.rejects(() => captureToPrivateSelectorReview(opts))
    assert.equal(count.calls, 0)
  }
})

test('product: only generic CSS proposals survive even with long class and numeric testid tokens', async () => {
  const count = { calls: 0 }
  const html = '<html><body><article class="product-card product-synthetic-identity9999">Mock</article>' +
    '<span data-testid="price-987654321" class="price-label">not-a-price</span>' +
    '<a href="/product/private-identification-777" class="offer-card">Mock</a></body></html>'
  const result = await captureToPrivateSelectorReview({
    ...base(), fetchFn: fake(html, count),
  })
  assert.equal(count.calls, 1)
  assert.equal(result.selectorProposals.some(s => s.selector === 'article.product-card'), true)
  assert.equal(result.selectorProposals.some(s => s.selector === 'span.price-label'), true)
  assert.equal(result.selectorProposals.some(s => s.selector === 'a[href^="/product/"]'), true)
  const displayed = JSON.stringify(result)
  assert.equal(displayed.includes('synthetic-identity9999'), false)
  assert.equal(displayed.includes('987654321'), false)
  assert.equal(displayed.includes('private-identification-777'), false)
  assert.equal(displayed.includes('not-a-price'), false)
  assert.equal(displayed.includes(plus), false)
  assert.equal(result.approvedSelectors, 0)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.currentPricesExtracted, false)
})

test('product: mutable caller permission document cannot be rewritten by mock transport', async () => {
  const opts = base(), count = { calls: 0 }
  opts.fetchFn = async () => {
    count.calls++
    // The injected transport owns the original object, but authorization
    // was validated against detached inert data descriptors.
    opts.permissionGate.sources[0].permissionStatus = 'unresolved'
    opts.grant.reviewed = false
    return new Response('<article class="product-card">Mock</article>', {
      status: 200, headers: { 'content-type': 'text/html' },
    })
  }
  const result = await captureToPrivateSelectorReview(opts)
  assert.equal(count.calls, 1)
  assert.equal(result.scopeCheckedForThisOneCapture, true)
  assert.equal(result.sourceRightsForPublicationVerified, false)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.scheduledFetchEnabled, false)
})
