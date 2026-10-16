import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  assertValidOfflineSelectorOrigin,
  proposeOfflineRetailerSelectors,
} from '../scripts/retailer-offline-selector-discovery.mjs'

const html = '<article class="product-card"><span class="price-value">synthetic</span></article>'
const original = () => ({
  retailerId: 'plus', url: 'https://www.plus.nl/producten',
  capturedAt: '2026-10-14T12:00:00.000Z',
})
const refusal = /Invalid or oversized offline retailer snapshot/

test('direct source refuses all accessor-backed identity fields without getter execution', () => {
  for (const key of ['retailerId', 'url', 'capturedAt']) {
    const origin = original()
    let called = 0
    Object.defineProperty(origin, key, {
      enumerable: true,
      get() { called++; return original()[key] },
    })
    assert.throws(() => assertValidOfflineSelectorOrigin(origin), refusal)
    assert.throws(() => proposeOfflineRetailerSelectors({ html, origin }), refusal)
    assert.equal(called, 0)
  }
})

test('both top-level request getters and Proxy traps are rejected before invocation', () => {
  for (const field of ['html', 'origin']) {
    const input = { html, origin: original() }
    let called = 0
    Object.defineProperty(input, field, {
      enumerable: true,
      get() { called++; return field === 'html' ? html : original() },
    })
    assert.throws(() => proposeOfflineRetailerSelectors(input), refusal)
    assert.equal(called, 0)
  }
  let reads = 0
  const request = new Proxy({ html, origin: original() }, {
    get(target, key) { reads++; return Reflect.get(target, key) },
  })
  assert.throws(() => proposeOfflineRetailerSelectors(request), refusal)
  assert.equal(reads, 0)
})

test('inherited or Proxy merchant identities and forged wrappers are refused', () => {
  const inherited = Object.assign(Object.create({ retailerId: 'plus' }), {
    url: original().url, capturedAt: original().capturedAt,
  })
  assert.throws(() => proposeOfflineRetailerSelectors({ html, origin: inherited }), refusal)
  let reads = 0
  const proxy = new Proxy(original(), {
    get(target, key) { reads++; return Reflect.get(target, key) },
  })
  assert.throws(() => proposeOfflineRetailerSelectors({ html, origin: proxy }), refusal)
  assert.equal(reads, 0)
  const foreignRequest = Object.assign(Object.create({ html }), {
    origin: original(),
  })
  assert.throws(() => proposeOfflineRetailerSelectors(foreignRequest), refusal)
})

test('unknown own fields, symbols, and overridden accessors cannot sneak into source provenance', () => {
  for (const tamper of [
    origin => { origin.extra = 'unverified' },
    origin => { origin[Symbol('secret')] = 'not-public' },
    origin => { delete origin.capturedAt },
  ]) {
    const origin = original()
    tamper(origin)
    assert.throws(() => proposeOfflineRetailerSelectors({ html, origin }), refusal)
  }
})

test('plain and null-prototype own-data source inputs remain hash-pinned, private and unchanged', () => {
  for (const origin of [
    original(),
    Object.assign(Object.create(null), original()),
  ]) {
    const request = { html, origin }
    const before = { retailerId: origin.retailerId, url: origin.url, capturedAt: origin.capturedAt }
    const report = proposeOfflineRetailerSelectors(request)
    assert.equal(report.source.retailerId, 'plus')
    assert.equal(report.source.capturedAt, before.capturedAt)
    assert.equal(report.source.sha256, createHash('sha256').update(html).digest('hex'))
    assert.equal(report.humanReviewRequired, true)
    assert.equal(report.permissionVerified, false)
    assert.equal(report.readyForIngestion, false)
    assert.equal(report.productionEnabled, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.ok(report.selectors.every(row => row.status === 'needs-human-review'))
    assert.equal(origin.retailerId, before.retailerId)
    assert.equal(origin.url, before.url)
    assert.equal(origin.capturedAt, before.capturedAt)
  }
})
