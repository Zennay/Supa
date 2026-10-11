import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

// #1484: physical own-index descriptors must remain data properties.
// The earlier status/slot permutation checks do not cover a slot becoming
// an accessor, or disappearing, *after* successful preflight.
function basket(id, rise = 0) {
  const products = m2Products.map(p => ({
    ...p, storeId: id, id: id + '-' + p.id,
    priceCents: p.priceCents + rise,
  }))
  products.push({
    id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', available: true, priceCents: 139 + rise,
  })
  const result = buildOneStoreBasket({
    store: { id, name: id }, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.matchedLineCount, 11)
  return result
}
function pair(rise = 0) {
  return { baseline: basket('test-store-a'), candidate: basket('test-store-b', rise) }
}
function guardedIndex(source, targetIndex, changed) {
  let reads = 0
  let getterCalls = 0
  let ordinaryGets = 0
  const proxy = new Proxy(source, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
      if (key !== String(targetIndex)) return descriptor
      reads++
      if (reads === 1 || changed === 'stable') return descriptor
      if (changed === 'missing') return undefined
      return {
        enumerable: descriptor.enumerable, configurable: true,
        get() {
          getterCalls++
          throw new Error('physical-slot accessor cannot be executed')
        },
      }
    },
    get(target, key, receiver) {
      if (key === String(targetIndex)) {
        ordinaryGets++
        throw new Error('physical-slot ordinary GET cannot be executed')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  return {
    proxy,
    get reads() { return reads },
    get getterCalls() { return getterCalls },
    get ordinaryGets() { return ordinaryGets },
  }
}
function assertUnknown(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}
for (const side of ['baseline', 'candidate']) {
  for (let index = 0; index < 11; index++) {
    for (const changed of ['accessor', 'missing']) {
      test(side + ' physical row ' + index + ' index descriptor becomes ' +
        changed + ' at snapshot and must abstain', () => {
        const data = pair()
        const spy = guardedIndex(data[side].lines, index, changed)
        data[side].lines = spy.proxy
        assertUnknown(compareFullBaskets(data))
        assert.equal(spy.reads, 2)
        assert.equal(spy.getterCalls, 0)
        assert.equal(spy.ordinaryGets, 0)
      })
    }
    test(side + ' physical row ' + index +
      ' stable index descriptor remains a trustworthy same-basket comparison', () => {
      const data = pair()
      const spy = guardedIndex(data[side].lines, index, 'stable')
      data[side].lines = spy.proxy
      const result = compareFullBaskets(data)
      assert.equal(result.claimable, true)
      assert.equal(result.outcome, 'same')
      assert.equal(result.savingsCents, 0)
      assert.equal(result.lineDeltas.length, 11)
      assert.equal(spy.reads, 2)
      assert.equal(spy.getterCalls, 0)
      assert.equal(spy.ordinaryGets, 0)
    })
  }
}
test('two-store stable slot proxies preserve weighted one-cent-per-pack worse', () => {
  const data = pair(1)
  const first = guardedIndex(data.baseline.lines, 0, 'stable')
  const last = guardedIndex(data.candidate.lines, 10, 'stable')
  data.baseline.lines = first.proxy
  data.candidate.lines = last.proxy
  const expected = basket('test-store-a').lines.reduce((n, line) => n + line.packs, 0)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, expected)
  assert.equal(result.savingsCents, -expected)
  assert.equal(first.getterCalls, 0)
  assert.equal(last.getterCalls, 0)
})
