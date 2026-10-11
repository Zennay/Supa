import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Expected RED on immutable #1464. Synthetic M2 4-meal/11-demand only.
function basket(storeId, rise = 0) {
  const products = m2Products.map(p => ({
    ...p, id: storeId + '-' + p.id, storeId, priceCents: p.priceCents + rise,
  }))
  products.push({
    id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + rise, available: true,
  })
  const result = buildOneStoreBasket({
    store: { id: storeId, name: storeId }, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.matchedLineCount, 11)
  return result
}
function pair(rise = 0) {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', rise) }
}

function driftingStoreId(basket, initialId) {
  const originalStore = basket.store
  let reads = 0
  let gets = 0
  basket.store = new Proxy(originalStore, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
      if (key === 'id') {
        reads++
        return { ...descriptor, value: reads === 1 ? initialId : descriptor.value }
      }
      return descriptor
    },
    get(target, key, receiver) {
      if (key === 'id') {
        gets++
        throw new Error('unsafe store id GET')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  return { get reads() { return reads }, get gets() { return gets } }
}

function requireUnknown(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}
for (const side of ['baseline', 'candidate']) {
  test('M3 ' + side + ' changing store id descriptor must abstain', () => {
    const data = pair()
    const otherStore = side === 'baseline' ? 'qa-deka' : 'qa-plus'
    const spy = driftingStoreId(data[side], otherStore)
    requireUnknown(compareFullBaskets(data))
    assert.equal(spy.reads, 2)
    assert.equal(spy.gets, 0)
  })
}

test('stable descriptor-only store Proxy retains a claimable same full basket', () => {
  const data = pair()
  data.baseline.store = new Proxy(data.baseline.store, {
    getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor,
    get(target, key, receiver) {
      if (key === 'id') throw new Error('unsafe store id GET')
      return Reflect.get(target, key, receiver)
    },
  })
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.lineDeltas.length, 11)
  assert.equal(result.savingsCents, 0)
})

test('frozen full baskets still compare one-cent-per-physical-pack worse', () => {
  const same = pair()
  Object.freeze(same.baseline.lines)
  Object.freeze(same.candidate.lines)
  assert.equal(compareFullBaskets(same).outcome, 'same')
  const data = pair(1)
  const packs = data.baseline.lines.reduce((n, line) => n + line.packs, 0)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, packs)
  assert.equal(result.savingsCents, -packs)
})
