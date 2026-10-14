import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

// #1484 independent full-slot QA: each permutation retains exactly the same
// 11 *already validated* matched row objects. No real retailer evidence.
function basket(storeId, priceIncrease = 0) {
  const products = m2Products.map(product => ({
    ...product, id: storeId + '-' + product.id, storeId,
    priceCents: product.priceCents + priceIncrease,
  }))
  products.push({
    id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + priceIncrease,
    available: true,
  })
  const result = buildOneStoreBasket({
    store: { id: storeId, name: storeId }, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.matchedLineCount, 11)
  assert.equal(result.unresolvedLineCount, 0)
  assert.ok(result.lines.every(row => row.status === 'matched'))
  return result
}
function pair(increase = 0) {
  return {
    baseline: basket('qa-plus'),
    candidate: basket('qa-deka', increase),
  }
}
function attachSlotProxy(data, side, first, second, drift) {
  const b = data[side]
  const actual = b.lines
  const reads = Array.from({ length: 11 }, () => 0)
  let indexedGets = 0
  let indexedDescriptorVisits = 0
  const wrapped = new Proxy(actual, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
      if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)) {
        return descriptor
      }
      const index = Number(key)
      if (index >= 11) return descriptor
      reads[index] += 1
      indexedDescriptorVisits += 1
      // Swap two slots after preflight, rather than introducing any missing ID,
      // row shape, product, demand or monetary inconsistency.
      if (!drift || reads[index] === 1 ||
          (index !== first && index !== second)) return descriptor
      return {
        ...descriptor,
        value: index === first ? actual[second] : actual[first],
      }
    },
    get(target, key, receiver) {
      if (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key)) {
        indexedGets += 1
        throw new Error('ordinary caller-owned indexed GET forbidden')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  b.lines = wrapped
  return {
    reads,
    get indexedGets() { return indexedGets },
    get indexedDescriptorVisits() { return indexedDescriptorVisits },
  }
}
function assertNoMoney(out) {
  assert.equal(out.outcome, 'unknown')
  assert.equal(out.claimable, false)
  assert.equal(out.deltaCents, null)
  assert.equal(out.savingsCents, null)
  assert.deepEqual(out.lineDeltas, [])
}
for (const side of ['baseline', 'candidate']) {
  for (let first = 0; first < 11; first += 1) {
    const second = (first + 1) % 11
    test(side + ' adjacent physical slot swap ' + first + '<->' + second +
      ' must be unclaimable', () => {
      const data = pair()
      const spy = attachSlotProxy(data, side, first, second, true)
      assertNoMoney(compareFullBaskets(data))
      assert.equal(spy.indexedGets, 0)
      assert.equal(spy.indexedDescriptorVisits, 22)
      assert.ok(spy.reads.every(count => count === 2))
    })
  }
  test(side + ' all 11 unchanged indexed descriptors retain claimable same', () => {
    const data = pair()
    const spy = attachSlotProxy(data, side, 0, 10, false)
    const out = compareFullBaskets(data)
    assert.equal(out.outcome, 'same')
    assert.equal(out.claimable, true)
    assert.equal(out.savingsCents, 0)
    assert.equal(out.deltaCents, 0)
    assert.equal(out.lineDeltas.length, 11)
    assert.equal(spy.indexedGets, 0)
    assert.equal(spy.indexedDescriptorVisits, 22)
    assert.ok(spy.reads.every(count => count === 2))
  })
}
test('both stable indexed proxies preserve pack-weighted one-cent worse', () => {
  const data = pair(1)
  const baseline = attachSlotProxy(data, 'baseline', 0, 10, false)
  const candidate = attachSlotProxy(data, 'candidate', 0, 10, false)
  const physicalPacks = basket('qa-plus').lines.reduce((sum, line) => sum + line.packs, 0)
  const out = compareFullBaskets(data)
  assert.equal(out.claimable, true)
  assert.equal(out.outcome, 'worse')
  assert.equal(out.deltaCents, physicalPacks)
  assert.equal(out.savingsCents, -physicalPacks)
  assert.equal(out.lineDeltas.length, 11)
  assert.equal(baseline.indexedGets, 0)
  assert.equal(candidate.indexedGets, 0)
})
test('frozen arrays preserve the exact 11-demand same result', () => {
  const data = pair()
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const out = compareFullBaskets(data)
  assert.equal(out.claimable, true)
  assert.equal(out.outcome, 'same')
  assert.equal(out.savingsCents, 0)
  assert.equal(out.lineDeltas.length, 11)
})
