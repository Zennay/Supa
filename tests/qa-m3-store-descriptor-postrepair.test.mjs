import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Independent #1465 source-fix acceptance; controlled M2 prices, no retailer evidence.
function basket(id, priceRise = 0) {
  const products = m2Products.map(p => ({
    ...p, id: id + '-' + p.id, storeId: id, priceCents: p.priceCents + priceRise,
  }))
  products.push({
    id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + priceRise, available: true,
  })
  const result = buildOneStoreBasket({
    store: { id, name: id }, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.matchedLineCount, 11)
  return result
}
function pair(extra = 0) {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', extra) }
}

function switchedStoreObject(basket, changedName) {
  const oldStore = basket.store
  const newStore = { ...oldStore, name: changedName ? oldStore.name + '-updated' : oldStore.name }
  let storeDescriptorReads = 0
  let storeGets = 0
  const wrapped = new Proxy(basket, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
      if (key === 'store') {
        storeDescriptorReads++
        return { ...descriptor, value: storeDescriptorReads === 1 ? oldStore : newStore }
      }
      return descriptor
    },
    get(target, key, receiver) {
      if (key === 'store') {
        storeGets++
        throw new Error('unsafe basket.store GET')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  return {
    wrapped,
    get reads() { return storeDescriptorReads },
    get gets() { return storeGets },
  }
}

function assertUnknown(result) {
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}
for (const side of ['baseline', 'candidate']) {
  for (const changedName of [false, true]) {
    test('postrepair ' + side + ' rejects store object replacement, changedName=' + changedName, () => {
      const data = pair()
      const spy = switchedStoreObject(data[side], changedName)
      data[side] = spy.wrapped
      assertUnknown(compareFullBaskets(data))
      assert.equal(spy.reads, 2)
      assert.equal(spy.gets, 0)
    })
  }
}

test('postrepair stable store object Proxy preserves 11-line same basket verdict', () => {
  const data = pair()
  data.baseline.store = new Proxy(data.baseline.store, {
    getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor,
    get(target, key, receiver) {
      if (key === 'id') throw new Error('unsafe store.id GET')
      return Reflect.get(target, key, receiver)
    },
  })
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
})

test('postrepair frozen baskets preserve exact +1-cent-per-physical-pack worsening', () => {
  const same = pair()
  Object.freeze(same.baseline.lines)
  Object.freeze(same.candidate.lines)
  assert.equal(compareFullBaskets(same).outcome, 'same')
  const data = pair(1)
  const physicalPacks = data.baseline.lines.reduce((n, line) => n + line.packs, 0)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, physicalPacks)
  assert.equal(result.savingsCents, -physicalPacks)
})
