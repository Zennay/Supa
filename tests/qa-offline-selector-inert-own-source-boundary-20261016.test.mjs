import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { proposeOfflineRetailerSelectors } from '../scripts/retailer-offline-selector-discovery.mjs'

// Independent offline-only QA. No fetchFn, retailer network, source license,
// product-price publication, or actual human 11+11 field measurements.
const html = '<article class="product-card"><span class="price-value">fictional</span></article>'
const plain = () => ({
  retailerId: 'plus', url: 'https://www.plus.nl/producten',
  capturedAt: '2026-10-14T12:00:00.000Z',
})
const refusal = /Invalid or oversized offline retailer snapshot/

test('QA expected RED: offline selector refuses accessor-backed merchant ID before running getter', () => {
  const origin = plain()
  let executed = 0
  Object.defineProperty(origin, 'retailerId', {
    enumerable: true, get() { executed++; return 'plus' },
  })
  assert.throws(() => proposeOfflineRetailerSelectors({ html, origin }), refusal)
  assert.equal(executed, 0)
})

test('QA expected RED: inherited merchant identity may not certify an offline review', () => {
  const origin = Object.assign(Object.create({ retailerId: 'plus' }), {
    url: 'https://www.plus.nl/producten', capturedAt: '2026-10-14T12:00:00.000Z',
  })
  assert.throws(() => proposeOfflineRetailerSelectors({ html, origin }), refusal)
})

test('QA expected RED: Proxy-wrapped source metadata must not execute get traps', () => {
  let executed = 0
  const origin = new Proxy(plain(), {
    get(target, key) { executed++; return Reflect.get(target, key) },
  })
  assert.throws(() => proposeOfflineRetailerSelectors({ html, origin }), refusal)
  assert.equal(executed, 0)
})

test('QA expected RED: top-level HTML accessor may not execute before caller validation', () => {
  let executed = 0
  const request = { origin: plain() }
  Object.defineProperty(request, 'html', {
    enumerable: true, get() { executed++; return html },
  })
  assert.throws(() => proposeOfflineRetailerSelectors(request), refusal)
  assert.equal(executed, 0)
})

test('QA positive: a plain, owned PLUS snapshot still emits only private review proposals', () => {
  const origin = plain()
  const input = { html, origin }
  const before = structuredClone(input)
  const result = proposeOfflineRetailerSelectors(input)
  assert.equal(result.source.retailerId, 'plus')
  assert.equal(result.source.capturedAt, origin.capturedAt)
  assert.equal(result.source.sha256, createHash('sha256').update(html).digest('hex'))
  assert.equal(result.permissionVerified, false)
  assert.equal(result.readyForIngestion, false)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.humanReviewRequired, true)
  assert.ok(result.selectors.every(row => row.status === 'needs-human-review'))
  assert.deepEqual(input, before)
  assert.doesNotMatch(JSON.stringify(result), /fictional|www\.plus\.nl/i)
})
