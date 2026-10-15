import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { captureToPrivateSelectorReview } from '../scripts/retailer-approved-capture-selector-bridge.mjs'

// Independent quality-validation of the frozen product #3041 bridge.
// ALL permissions and source payloads in positive tests are FICTIONAL,
// never evidence of permission to contact PLUS or DekaMarkt.
// An injected Response is the only transport. Never use global fetch.
const CAPTURED_AT = '2026-10-14T12:00:00.000Z'
const PLUS = 'https://www.plus.nl/producten'
const FICTIONAL_MARKER = 'privateingredientolive777'
const html = '<html><body><article class="product-card"><span class="price-label">FAKE ONLY</span></article></body></html>'

function gate() {
  return {
    version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-14',
    sources: ['plus', 'dekamarkt'].map(supermarket => ({
      supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
      productionEnabled: true, evidence: [{ kind: 'written_permission',
        url: 'https://example.test/fictional-permission-not-a-license',
        finding: 'Synthetic test document only; neither store authorized.' }],
    })),
  }
}

function grant() {
  return {
    supermarket: 'plus', kind: 'catalog', sourceUrl: PLUS,
    reviewed: true, termsReviewed: true, robotsReviewed: true,
    noAntiBotBypass: true,
  }
}

function options(extra = {}) {
  return {
    source: { supermarket: 'plus', kind: 'catalog', url: PLUS },
    grant: grant(), permissionGate: gate(), capturedAt: CAPTURED_AT,
    ...extra,
  }
}

function mockHtml(body = html, observer = () => {}) {
  return async (url, init) => {
    observer(url, init)
    return new Response(body, {
      status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }
}

test('positive: an ordinary immutable fictional one-page capture remains review-only and redacted', async () => {
  let calls = 0
  const result = await captureToPrivateSelectorReview(options({
    fetchFn: mockHtml(html, (url, init) => {
      calls++
      assert.equal(url, PLUS)
      assert.equal(init.redirect, 'error')
      assert.equal(init.credentials, 'omit')
    }),
  }))
  assert.equal(calls, 1)
  assert.equal(result.selectorProposals.some(x => x.selector === 'article.product-card'), true)
  assert.equal(result.humanSelectorApprovalRequired, true)
  assert.equal(result.approvedSelectors, 0)
  assert.equal(result.readyForIngestion, false)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(JSON.stringify(result).includes(PLUS), false)
  assert.equal(JSON.stringify(result).includes('FAKE ONLY'), false)
})

test('positive: actual checked-in gate must deny both retailers before injected transport', async () => {
  const realGate = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8',
  ))
  let calls = 0
  for (const [supermarket, kind, url] of [
    ['plus', 'catalog', PLUS],
    ['dekamarkt', 'offers', 'https://www.dekamarkt.nl/aanbiedingen'],
  ]) {
    await assert.rejects(() => captureToPrivateSelectorReview({
      ...options(), source: { supermarket, kind, url },
      grant: { ...grant(), supermarket, kind, sourceUrl: url },
      permissionGate: realGate, fetchFn: mockHtml(html, () => { calls++ }),
    }), /Explicit retailer source permission required/u)
  }
  assert.equal(calls, 0)
})

test('expected RED: grant accessor cannot revoke permission during validation and still initiate a capture', async () => {
  const permissionGate = gate()
  const mutableGrant = grant()
  Object.defineProperty(mutableGrant, 'reviewed', {
    enumerable: true, configurable: true,
    get() {
      // Mutation happens after the source permission gate was validated but
      // still before the network capability is exercised.
      const retailer = permissionGate.sources.find(x => x.supermarket === 'plus')
      retailer.permissionStatus = 'permission_required'
      retailer.productionEnabled = false
      return true
    },
  })
  let calls = 0
  await assert.rejects(
    () => captureToPrivateSelectorReview(options({
      permissionGate, grant: mutableGrant,
      fetchFn: mockHtml(html, () => { calls++ }),
    })),
    /refused|permission|immutable|scope/iu,
    'revoked/internally mutable grants must fail closed before transport',
  )
  assert.equal(calls, 0,
    'retailer transport cannot run after permission is withdrawn mid-validation')
})

test('expected RED: CSS proposals must not reproduce a source-embedded fictional product identifier', async () => {
  // A literal class name is NOT automatically safe metadata. It can contain
  // a product identity or price-looking token from the HTML source itself.
  const syntheticHtml = '<html><body>' +
    '<article class="product-' + FICTIONAL_MARKER + '">Mock</article>' +
    '<span data-testid="price-987654321">Unknown fictional price</span>' +
    '</body></html>'
  let calls = 0
  const result = await captureToPrivateSelectorReview(options({
    fetchFn: mockHtml(syntheticHtml, () => { calls++ }),
  }))
  assert.equal(calls, 1)
  const output = JSON.stringify(result)
  assert.equal(output.includes(FICTIONAL_MARKER), false,
    'the selector preview must not echo a product-specific source identifier')
  assert.equal(result.approvedSelectors, 0)
  assert.equal(result.readyForIngestion, false)
  assert.equal(result.currentPricesExtracted, false)
})

test('expected RED: CSS data-testid proposals must not reproduce source-dependent price-shaped tokens', async () => {
  // This numeric marker is NOT a real price, just a controlled private
  // source attribute value that must not be returned as safe metadata.
  const priceMarker = '987654321'
  const onlyFakePriceSource =
    '<html><body><span data-testid="price-' + priceMarker + '">Mock</span></body></html>'
  let calls = 0
  const result = await captureToPrivateSelectorReview(options({
    fetchFn: mockHtml(onlyFakePriceSource, () => { calls++ }),
  }))
  assert.equal(calls, 1)
  assert.equal(JSON.stringify(result).includes(priceMarker), false,
    'private source-dependent price-shaped tokens must not be disclosed as selectors')
  assert.equal(result.approvedSelectors, 0)
  assert.equal(result.currentPricesExtracted, false)
  assert.equal(result.publicSavingsClaimEligible, false)
})
