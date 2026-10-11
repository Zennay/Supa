import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

// Independent positive mirror of physical-slot drift #1484/#1490.
// A stable reordered array is valid: same demand IDs in different physical
// order must not be mistaken for an in-flight descriptor swap.
function basket(storeId, increase = 0) {
  const products = m2Products.map(product => ({
    ...product, id: storeId + '-' + product.id, storeId,
    priceCents: product.priceCents + increase,
  }))
  products.push({
    id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + increase,
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
function pair(increase = 0) {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', increase) }
}
function stableReorder(data, side, shift) {
  const basketData = data[side]
  const original = basketData.lines
  const rotated = original.slice(shift).concat(original.slice(0, shift))
  let propertyGets = 0
  let descriptorReads = 0
  basketData.lines = new Proxy(rotated, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
      if (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key)) {
        descriptorReads++
      }
      return descriptor
    },
    get(target, key, receiver) {
      if (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key)) {
        propertyGets++
        throw new Error('ordinary physical-row GET forbidden')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  return {
    get propertyGets() { return propertyGets },
    get descriptorReads() { return descriptorReads },
  }
}
function assertCanonicalSame(result) {
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.deltaCents, 0)
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
  assert.equal(new Set(result.lineDeltas.map(row => row.id)).size, 11)
  assert.ok(result.lineDeltas.every(row => row.deltaCents === 0))
}
for (const side of ['baseline', 'candidate']) {
  for (let shift = 1; shift < 11; shift++) {
    test(side + ' stable preflight rotation by ' + shift + ' remains claimable', () => {
      const data = pair()
      const spy = stableReorder(data, side, shift)
      assertCanonicalSame(compareFullBaskets(data))
      assert.equal(spy.propertyGets, 0)
      assert.equal(spy.descriptorReads, 22)
    })
  }
}
test('both stores independently reordered retain physical 1-cent/pack worse', () => {
  const data = pair(1)
  const physicalPacks = data.baseline.lines.reduce((total, row) => total + row.packs, 0)
  const baseline = stableReorder(data, 'baseline', 10)
  const candidate = stableReorder(data, 'candidate', 3)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, physicalPacks)
  assert.equal(result.savingsCents, -physicalPacks)
  assert.equal(result.lineDeltas.length, 11)
  assert.equal(result.lineDeltas.reduce((total, row) => total + row.deltaCents, 0), physicalPacks)
  assert.equal(baseline.propertyGets, 0)
  assert.equal(candidate.propertyGets, 0)
  assert.equal(baseline.descriptorReads, 22)
  assert.equal(candidate.descriptorReads, 22)
})
test('frozen reversed arrays on both stores stay claimable', () => {
  const data = pair()
  data.baseline.lines = [...data.baseline.lines].reverse()
  data.candidate.lines = [...data.candidate.lines].reverse()
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  assertCanonicalSame(compareFullBaskets(data))
})
