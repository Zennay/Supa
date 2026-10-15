import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { captureToPrivateSelectorReview } from '../scripts/retailer-approved-capture-selector-bridge.mjs'
import { captureApprovedRetailerPage } from '../scripts/retailer-approved-snapshot-capture.mjs'

// Product-owned regression probes use injected Response only; fictional rights
// are NEVER permission to fetch either real retailer. No external network.
const url = 'https://www.plus.nl/producten'
const at = '2026-10-14T12:00:00.000Z'
const grant = () => ({
  supermarket: 'plus', kind: 'catalog', sourceUrl: url, reviewed: true,
  termsReviewed: true, robotsReviewed: true, noAntiBotBypass: true,
})
const gate = () => ({
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-14',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true, evidence: [{
      kind: 'written_permission',
      url: 'https://example.test/fictional-permission',
      finding: 'Fictional test-only record, not a license.',
    }],
  })),
})
const opts = extra => ({
  source: { supermarket: 'plus', kind: 'catalog', url },
  permissionGate: gate(), grant: grant(), capturedAt: at, ...extra,
})
function fakeTransport(html, onCall = () => {}) {
  return async () => {
    onCall()
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
  }
}

test('product: frozen fictional consent yields SHA-linked generic review-only selectors', async () => {
  let calls = 0
  const result = await captureToPrivateSelectorReview(opts({
    fetchFn: fakeTransport('<article class="product-card"><span class="price-label">123</span></article>', () => calls++),
  }))
  assert.equal(calls, 1)
  assert.deepEqual(result.selectorProposals.map(x => x.selector).sort(),
    ['article.product-card', 'span.price-label'])
  assert.equal(result.selectorProposalCount, 2)
  assert.equal(result.readyForIngestion, false)
  assert.equal(result.approvedSelectors, 0)
  assert.equal(result.publicSavingsClaimEligible, false)
})

test('product: grant reviewed accessor is rejected without a transport or rights mutation', async () => {
  const permissionGate = gate()
  const oneGrant = grant()
  let accessorCalls = 0
  Object.defineProperty(oneGrant, 'reviewed', {
    get() {
      accessorCalls++
      permissionGate.sources[0].permissionStatus = 'permission_required'
      return true
    },
  })
  let calls = 0
  await assert.rejects(captureToPrivateSelectorReview(opts({
    permissionGate, grant: oneGrant,
    fetchFn: fakeTransport('<article class="product-card">Fake</article>', () => calls++),
  })), /Immutable capture permission data/u)
  assert.equal(accessorCalls, 0)
  assert.equal(calls, 0)
  assert.equal(permissionGate.sources[0].permissionStatus, 'permitted')
})

test('product: source URL accessor, nested permission accessor and Proxy fail before transport', async () => {
  for (const mutate of [
    o => Object.defineProperty(o.source, 'url', { get() { throw Error('UNSAFE_SOURCE_GETTER') } }),
    o => Object.defineProperty(o.permissionGate.sources[0], 'permissionStatus', { get() { throw Error('UNSAFE_PERMISSION_GETTER') } }),
    o => { o.grant = new Proxy(grant(), { get() { throw Error('UNSAFE_PROXY_READ') } }) },
  ]) {
    const o = opts()
    mutate(o)
    let calls = 0
    o.fetchFn = fakeTransport('<span class="price-label">mock</span>', () => calls++)
    await assert.rejects(captureApprovedRetailerPage(o), /Immutable capture/u)
    assert.equal(calls, 0)
  }
})

test('product: class and testid with fictional product or price fingerprints are never returned', async () => {
  const secret = 'privateingredientolive777'
  const price = '987654321'
  const html = '<article class="product-' + secret + '">Synthetic</article>' +
    '<span data-testid="price-' + price + '">Fake</span>' +
    '<div class="offer-card">Mock</div>'
  const result = await captureToPrivateSelectorReview(opts({ fetchFn: fakeTransport(html) }))
  assert.equal(result.selectorProposals.some(s => s.selector === 'div.offer-card'), true)
  assert.equal(JSON.stringify(result).includes(secret), false)
  assert.equal(JSON.stringify(result).includes(price), false)
  assert.equal(result.sourceRightsForPublicationVerified, false)
  assert.equal(result.currentPricesExtracted, false)
})

test('product: the actual PLUS/Deka rights still refuse injected one-page capture', async () => {
  const actual = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8',
  ))
  let calls = 0
  for (const [supermarket, kind, sourceUrl] of [
    ['plus', 'catalog', url],
    ['dekamarkt', 'offers', 'https://www.dekamarkt.nl/aanbiedingen'],
  ]) {
    await assert.rejects(captureToPrivateSelectorReview({
      source: { supermarket, kind, url: sourceUrl },
      grant: { ...grant(), supermarket, kind, sourceUrl },
      permissionGate: actual, capturedAt: at,
      fetchFn: fakeTransport('forbidden', () => calls++),
    }), /Explicit retailer source permission required/u)
  }
  assert.equal(calls, 0)
})
