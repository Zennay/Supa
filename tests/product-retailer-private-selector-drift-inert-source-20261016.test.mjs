import assert from 'node:assert/strict'
import test from 'node:test'
import { proposeOfflineRetailerSelectors } from '../scripts/retailer-offline-selector-discovery.mjs'
import { compareOfflineSelectorProposals, main } from '../scripts/retailer-private-selector-drift.mjs'

const html = '<article class="product-card"><span class="price-value">fictional</span></article>'
const origin = time => ({
  retailerId: 'plus',
  url: 'https://www.plus.nl/producten',
  capturedAt: time,
})
const sample = time => proposeOfflineRetailerSelectors({ html, origin: origin(time) })
const original = () => sample('2024-02-29T10:00:00Z')
const later = () => sample('2026-10-14T10:00:00Z')
const denied = /Private selector drift comparison refused/

test('source field getters, even valid-looking, never execute during private drift review', () => {
  for (const field of ['retailerId', 'sha256', 'capturedAt']) {
    let reads = 0
    const a = original()
    const expected = a.source[field]
    Object.defineProperty(a.source, field, {
      configurable: true, enumerable: true,
      get() { ++reads; return expected },
    })
    assert.throws(() => compareOfflineSelectorProposals(a, later()), denied)
    assert.equal(reads, 0, field)
  }
})

test('no top-level or nested reviewer getter may execute or authenticate source evidence', () => {
  for (const [objectField, property] of [
    ['report', 'source'],
    ['signals', 'jsonLd'],
    ['selector', 'field'],
  ]) {
    let reads = 0
    const a = original()
    const target = objectField === 'report' ? a
      : objectField === 'signals' ? a.structuredSignals : a.selectors[0]
    const expected = target[property]
    Object.defineProperty(target, property, {
      configurable: true, enumerable: true,
      get() { ++reads; return expected },
    })
    assert.throws(() => compareOfflineSelectorProposals(a, later()), denied)
    assert.equal(reads, 0, objectField + '.' + property)
  }
})

test('Proxy-wrapped report, origin, signals, array and row never execute get traps', () => {
  for (const field of ['report','source','structuredSignals','selectors','row']) {
    let reads = 0
    const a = original()
    const target = field === 'report' ? a : field === 'row' ? a.selectors[0] : a[field]
    const wrapped = new Proxy(target, {
      get(t, key) { ++reads; return Reflect.get(t, key) },
      ownKeys(t) { ++reads; return Reflect.ownKeys(t) },
    })
    if (field === 'report') {
      assert.throws(() => compareOfflineSelectorProposals(wrapped, later()), denied)
    } else if (field === 'row') {
      a.selectors[0] = wrapped
      assert.throws(() => compareOfflineSelectorProposals(a, later()), denied)
    } else {
      a[field] = wrapped
      assert.throws(() => compareOfflineSelectorProposals(a, later()), denied)
    }
    assert.equal(reads, 0, field)
  }
})

test('inherited, extra-symbol, and accessor array indices refuse source drift', () => {
  const a = original()
  delete a.source.retailerId
  Object.setPrototypeOf(a.source, { retailerId: 'plus' })
  assert.throws(() => compareOfflineSelectorProposals(a, later()), denied)

  const withSymbol = original()
  withSymbol[Symbol('invisible metadata')] = 'trick'
  assert.throws(() => compareOfflineSelectorProposals(withSymbol, later()), denied)

  const arrayGetter = original()
  let reads = 0
  const row = arrayGetter.selectors[0]
  Object.defineProperty(arrayGetter.selectors, 0, {
    configurable: true, enumerable: true,
    get() { ++reads; return row },
  })
  assert.throws(() => compareOfflineSelectorProposals(arrayGetter, later()), denied)
  assert.equal(reads, 0)
})

test('plain original inputs remain unchanged, private and acceptable incl null prototype', () => {
  const a = original()
  const b = later()
  const frozenBefore = structuredClone(a)
  const frozenAfter = structuredClone(b)
  b.source = Object.assign(Object.create(null), b.source)
  const report = compareOfflineSelectorProposals(a, b)
  assert.equal(report.mode, 'private-offline-selector-drift-alert')
  assert.equal(report.permissionVerified, false)
  assert.equal(report.automatedSelectorPromotion, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.externalRequests, 0)
  assert.deepEqual(a, frozenBefore)
  assert.deepEqual({ ...b, source: { ...b.source } }, frozenAfter)
  assert.doesNotMatch(JSON.stringify(report), /fictional|sha256|www\.plus\.nl|capturedAt/)
})

test('private selector-drift CLI refuses hostile argv before resolving any path', async () => {
  const originalArgs = ['--before', '/not/a/real/old.json', '--after', '/not/a/real/new.json']
  let reads = 0
  const lazy = [...originalArgs]
  Object.defineProperty(lazy, 1, {
    enumerable: true, configurable: true,
    get() { ++reads; return '/not/a/real/old.json' },
  })
  let printed = ''
  await assert.rejects(main(lazy, x => { printed += x }), denied)
  assert.equal(reads, 0)
  assert.equal(printed, '')

  const wrapped = new Proxy([...originalArgs], {
    get(target, key) { ++reads; return Reflect.get(target, key) },
    ownKeys(target) { ++reads; return Reflect.ownKeys(target) },
  })
  await assert.rejects(main(wrapped, x => { printed += x }), denied)
  assert.equal(reads, 0)
  assert.equal(printed, '')

  const sparse = [...originalArgs]
  delete sparse[3]
  await assert.rejects(main(sparse), denied)
  const symbolized = [...originalArgs]
  symbolized[Symbol('hidden')] = 'unreviewed'
  await assert.rejects(main(symbolized), denied)
})

test('private drift refuses absolute or relative product roots from another retailer', () => {
  const before = original()
  for (const selector of [
    'a[href^="/producten/"]',
    'a[href^="https://www.dekamarkt.nl/producten/"]',
    'a[href^="//www.dekamarkt.nl/producten/"]',
  ]) {
    const forged = structuredClone(later())
    forged.selectors.push({ field: 'product', selector,
      instances: 1, status: 'needs-human-review' })
    assert.throws(() => compareOfflineSelectorProposals(before, forged), denied)
  }
})
