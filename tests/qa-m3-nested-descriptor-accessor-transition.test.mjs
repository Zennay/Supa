import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

// Independent nested descriptor boundary follow-up. All prices are synthetic;
// these tests neither acquire nor represent observed retailer field evidence.
function basket(id, uplift = 0) {
  const products = m2Products.map(p => ({
    ...p, id: id + '-' + p.id, storeId: id,
    priceCents: p.priceCents + uplift,
  }))
  products.push({
    id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + uplift,
    available: true,
  })
  const basket = buildOneStoreBasket({
    store: { id, name: id }, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(basket.lines.length, 11)
  assert.equal(basket.unresolvedLineCount, 0)
  return basket
}
function makePair(uplift = 0) {
  return { baseline: basket('synthetic-a'), candidate: basket('synthetic-b', uplift) }
}
function ownDescriptorProxy(source, field, accessorOnRead) {
  let reads = 0
  let getterCalls = 0
  let ordinaryGets = 0
  return {
    proxy: new Proxy(source, {
      getOwnPropertyDescriptor(target, key) {
        const existing = Reflect.getOwnPropertyDescriptor(target, key)
        if (key !== field) return existing
        reads++
        if (reads < accessorOnRead) return existing
        return {
          enumerable: existing?.enumerable ?? true,
          configurable: true,
          get() {
            getterCalls++
            throw new Error('derived price must never invoke an input accessor')
          },
        }
      },
      get(target, key, receiver) {
        if (key === field) {
          ordinaryGets++
          throw new Error('untrusted ordinary property GET forbidden')
        }
        return Reflect.get(target, key, receiver)
      },
    }),
    get reads() { return reads },
    get getterCalls() { return getterCalls },
    get ordinaryGets() { return ordinaryGets },
  }
}
function unknown(comparison) {
  assert.equal(comparison.outcome, 'unknown')
  assert.equal(comparison.claimable, false)
  assert.equal(comparison.deltaCents, null)
  assert.equal(comparison.savingsCents, null)
  assert.deepEqual(comparison.lineDeltas, [])
}
for (const side of ['baseline', 'candidate']) {
  for (const index of [0, 5, 10]) {
    for (const [scope, field] of [
      ['requirement', 'amount'], ['requirement', 'unit'],
      ['pack', 'amount'], ['pack', 'unit'], ['pack', 'count'],
    ]) {
      test(side + ' row ' + index + ' ' + scope + '.' + field +
        ': data becomes accessor at snapshot and must not execute', () => {
        const data = makePair()
        const original = data[side].lines[index]
        const spy = ownDescriptorProxy(original[scope], field, 2)
        original[scope] = spy.proxy
        unknown(compareFullBaskets(data))
        assert.equal(spy.reads, 2)
        assert.equal(spy.getterCalls, 0)
        assert.equal(spy.ordinaryGets, 0)
      })
    }
  }
  test(side + ' root lines descriptor becomes accessor only on third read', () => {
    const data = makePair()
    const spy = ownDescriptorProxy(data[side], 'lines', 3)
    data[side] = spy.proxy
    unknown(compareFullBaskets(data))
    assert.equal(spy.reads, 3)
    assert.equal(spy.getterCalls, 0)
    assert.equal(spy.ordinaryGets, 0)
  })
  for (const [scope, field] of [
    ['requirement', 'amount'], ['requirement', 'unit'],
    ['pack', 'amount'], ['pack', 'unit'], ['pack', 'count'],
  ]) {
    test(side + ' stable descriptor proxy for ' + scope + '.' + field +
      ' remains claimable without GET', () => {
      const data = makePair(1)
      const original = data[side].lines[5]
      const spy = ownDescriptorProxy(original[scope], field, Number.POSITIVE_INFINITY)
      original[scope] = spy.proxy
      const result = compareFullBaskets(data)
      const packs = basket('synthetic-a').lines.reduce((n, line) => n + line.packs, 0)
      assert.equal(result.claimable, true)
      assert.equal(result.outcome, 'worse')
      assert.equal(result.deltaCents, packs)
      assert.equal(result.savingsCents, -packs)
      assert.equal(result.lineDeltas.length, 11)
      assert.equal(spy.reads, 2)
      assert.equal(spy.getterCalls, 0)
      assert.equal(spy.ordinaryGets, 0)
    })
  }
}
