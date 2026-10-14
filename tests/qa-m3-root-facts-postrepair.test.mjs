import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Independent #1469 postrepair acceptance on immutable source-only fix #1471.
function basket(id, rise = 0) {
  const products = m2Products.map(p => ({
    ...p, id: id + '-' + p.id, storeId: id, priceCents: p.priceCents + rise,
  }))
  products.push({
    id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + rise, available: true,
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
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', rise) }
}

function changedRootDescriptor(basket, field) {
  let descriptors = 0
  let gets = 0
  const proxy = new Proxy(basket, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
      if (key === field) {
        descriptors++
        return { ...descriptor, value: descriptors === 1 ? descriptor.value + 1 : descriptor.value }
      }
      return descriptor
    },
    get(target, key, receiver) {
      if (key === field) {
        gets++
        throw new Error('unsafe root GET')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  return { proxy, get descriptors() { return descriptors }, get gets() { return gets } }
}

function assertUnknown(result) {
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

for (const side of ['baseline', 'candidate']) {
  for (const key of ['selectedMealCount', 'unresolvedLineCount']) {
    test('postrepair ' + side + ' rejects changed root ' + key, () => {
      const data = pair()
      const spy = changedRootDescriptor(data[side], key)
      data[side] = spy.proxy
      assertUnknown(compareFullBaskets(data))
      assert.equal(spy.descriptors, 2)
      assert.equal(spy.gets, 0)
    })
  }
}

test('stable root descriptor Proxy retains exact claimable 11-line equality', () => {
  const data = pair()
  data.candidate = new Proxy(data.candidate, {
    getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor,
    get(target, key, receiver) {
      if (key === 'selectedMealCount') throw new Error('unsafe selectedMealCount GET')
      return Reflect.get(target, key, receiver)
    },
  })
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
})

test('frozen full basket remains pack-weighted worse at +1-cent-per-pack', () => {
  const equal = pair()
  Object.freeze(equal.baseline.lines)
  Object.freeze(equal.candidate.lines)
  assert.equal(compareFullBaskets(equal).outcome, 'same')
  const raised = pair(1)
  const packs = raised.baseline.lines.reduce((total, row) => total + row.packs, 0)
  const result = compareFullBaskets(raised)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, packs)
  assert.equal(result.savingsCents, -packs)
})
