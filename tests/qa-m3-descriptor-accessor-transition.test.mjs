import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

// Independent QA for existing #1484 descriptor-snapshot safety.
// Synthetic 4-meal / 11-demand controls only, NOT PLUS/DekaMarkt field proof.
function basket(storeId, perPackIncrease = 0) {
  const products = m2Products.map((p) => ({
    ...p, id: storeId + '-' + p.id, storeId,
    priceCents: p.priceCents + perPackIncrease,
  }))
  products.push({
    id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + perPackIncrease,
    available: true,
  })
  const result = buildOneStoreBasket({
    store: { id: storeId, name: storeId }, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.matchedLineCount, 11)
  return result
}
function pair(extra = 0) {
  return { baseline: basket('fixture-a'), candidate: basket('fixture-b', extra) }
}
function guardOwnDescriptor(object, field, changeToAccessorOnRead = 2) {
  let reads = 0
  let getterCalls = 0
  let ordinaryGets = 0
  const wrapped = new Proxy(object, {
    getOwnPropertyDescriptor(target, key) {
      const old = Reflect.getOwnPropertyDescriptor(target, key)
      if (key !== field) return old
      reads++
      if (reads < changeToAccessorOnRead) return old
      return {
        configurable: true, enumerable: old?.enumerable ?? true,
        get() {
          getterCalls++
          throw new Error('untrusted accessor must never execute')
        },
      }
    },
    get(target, key, receiver) {
      if (key === field) {
        ordinaryGets++
        throw new Error('ordinary caller GET must never execute')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  return {
    wrapped,
    get reads() { return reads },
    get getterCalls() { return getterCalls },
    get ordinaryGets() { return ordinaryGets },
  }
}
function abstains(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}
for (const side of ['baseline', 'candidate']) {
  for (const index of [0, 5, 10]) {
    for (const field of ['status', 'pricePerPackCents', 'productId']) {
      test(side + ' row ' + index + ' ' + field +
        ': own data -> accessor at snapshot must fail closed without execution', () => {
        const data = pair()
        const spy = guardOwnDescriptor(data[side].lines[index], field)
        data[side].lines[index] = spy.wrapped
        abstains(compareFullBaskets(data))
        assert.equal(spy.reads, 2)
        assert.equal(spy.getterCalls, 0)
        assert.equal(spy.ordinaryGets, 0)
      })
    }
  }
  for (const [scope, field] of [['store', 'id'], ['root', 'totalCents']]) {
    test(side + ' ' + scope + '.' + field +
      ': accessor substituted only at snapshot cannot become trusted', () => {
      const data = pair()
      const target = scope === 'store' ? data[side].store : data[side]
      const spy = guardOwnDescriptor(target, field)
      if (scope === 'store') data[side].store = spy.wrapped
      else data[side] = spy.wrapped
      abstains(compareFullBaskets(data))
      assert.equal(spy.reads, 2)
      assert.equal(spy.getterCalls, 0)
      assert.equal(spy.ordinaryGets, 0)
    })
  }
}
for (const side of ['baseline', 'candidate']) {
  for (const field of ['status', 'pricePerPackCents', 'productId']) {
    test(side + ' preflight ' + field +
      ': first descriptor is an accessor, do not even snapshot it', () => {
      const data = pair()
      const spy = guardOwnDescriptor(data[side].lines[5], field, 1)
      data[side].lines[5] = spy.wrapped
      abstains(compareFullBaskets(data))
      // 'status' checks both ownData and Object.hasOwn on accessor
      // preflight; neither probe invokes the supplied getter.
      assert.equal(spy.reads, field === 'status' ? 2 : 1)
      assert.equal(spy.getterCalls, 0)
      assert.equal(spy.ordinaryGets, 0)
    })
  }
}
