import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Expected RED root basket facts; synthetic M2 4-meal/11-demand, no retailer evidence.
function basket(storeId, bump = 0) {
  const products = m2Products.map(p => ({
    ...p, id: storeId + '-' + p.id, storeId, priceCents: p.priceCents + bump,
  }))
  products.push({
    id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + bump, available: true,
  })
  const result = buildOneStoreBasket({
    store: { id: storeId, name: storeId }, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.matchedLineCount, 11)
  return result
}
function pair(bump = 0) {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', bump) }
}

function changingRootFact(basket, key) {
  let reads = 0
  let gets = 0
  const wrapped = new Proxy(basket, {
    getOwnPropertyDescriptor(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property)
      if (property === key) {
        reads++
        return { ...descriptor, value: reads === 1 ? descriptor.value + 1 : descriptor.value }
      }
      return descriptor
    },
    get(target, property, receiver) {
      if (property === key) {
        gets++
        throw new Error('unsafe root basket GET')
      }
      return Reflect.get(target, property, receiver)
    },
  })
  return { wrapped, get reads() { return reads }, get gets() { return gets } }
}

function requireUnknown(result) {
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

for (const side of ['baseline', 'candidate']) {
  for (const key of ['totalCents', 'matchedLineCount']) {
    test('M3 ' + side + ' root ' + key + ' descriptor drift must abstain', () => {
      const data = pair()
      const spy = changingRootFact(data[side], key)
      data[side] = spy.wrapped
      requireUnknown(compareFullBaskets(data))
      assert.equal(spy.reads, 2)
      assert.equal(spy.gets, 0)
    })
  }
}

test('stable root descriptor Proxy preserves exact canonical equality', () => {
  const data = pair()
  data.baseline = new Proxy(data.baseline, {
    getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor,
    get(target, key, receiver) {
      if (key === 'totalCents') throw new Error('unsafe total cents GET')
      return Reflect.get(target, key, receiver)
    },
  })
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
})

test('frozen canonical full baskets preserve physical +1 cent pack weighting', () => {
  const same = pair()
  Object.freeze(same.baseline.lines)
  Object.freeze(same.candidate.lines)
  assert.equal(compareFullBaskets(same).outcome, 'same')
  const data = pair(1)
  const packs = data.baseline.lines.reduce((n, row) => n + row.packs, 0)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, packs)
  assert.equal(result.savingsCents, -packs)
})
