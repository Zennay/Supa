import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Synthetic QA of root `lines` descriptor TOCTOU; this is not retailer evidence.
function basket(storeId, increase = 0) {
  const products = m2Products.map(p => ({
    ...p, id: storeId + '-' + p.id, storeId, priceCents: p.priceCents + increase,
  }))
  products.push({ id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + increase, available: true })
  const b = buildOneStoreBasket({
    store: { id: storeId, name: storeId }, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(b.lines.length, 11)
  assert.equal(b.matchedLineCount, 11)
  assert.equal(b.unresolvedLineCount, 0)
  return b
}
function pair(increase = 0) {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', increase) }
}
function replaceAfterPreflight(data, side, swap) {
  const original = data[side]
  const originalLines = original.lines
  // All rows are the SAME preflighted objects: a line WeakMap cannot spot this.
  const otherLines = [...originalLines]
  let methodGets = 0
  Object.defineProperty(otherLines, 'filter', {
    configurable: true,
    get() {
      methodGets++
      throw new Error('shadowed filter must never run')
    },
  })
  let descriptorReads = 0
  let propertyGets = 0
  data[side] = new Proxy(original, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
      if (key !== 'lines') return descriptor
      descriptorReads++
      return { ...descriptor, value: swap && descriptorReads >= 3
        ? otherLines : originalLines }
    },
    get(target, key, receiver) {
      if (key === 'lines') {
        propertyGets++
        throw new Error('ordinary root lines GET must never run')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  return {
    get descriptorReads() { return descriptorReads },
    get propertyGets() { return propertyGets },
    get methodGets() { return methodGets },
  }
}
function unknown(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

for (const side of ['baseline', 'candidate']) {
  test('changing ' + side + ' lines array after preflight must abstain', () => {
    const data = pair()
    const spy = replaceAfterPreflight(data, side, true)
    unknown(compareFullBaskets(data))
    assert.equal(spy.descriptorReads, 3)
    assert.equal(spy.propertyGets, 0)
    assert.equal(spy.methodGets, 0)
  })
  test('stable ' + side + ' root lines descriptor is claimable', () => {
    const data = pair()
    const spy = replaceAfterPreflight(data, side, false)
    const result = compareFullBaskets(data)
    assert.equal(result.outcome, 'same')
    assert.equal(result.claimable, true)
    assert.equal(result.savingsCents, 0)
    assert.equal(result.lineDeltas.length, 11)
    assert.equal(spy.descriptorReads, 3)
    assert.equal(spy.propertyGets, 0)
    assert.equal(spy.methodGets, 0)
  })
}
test('frozen original 11-demand baskets stay cent-exact', () => {
  const data = pair(1)
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const packs = data.baseline.lines.reduce((n, row) => n + row.packs, 0)
  const result = compareFullBaskets(data)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.claimable, true)
  assert.equal(result.deltaCents, packs)
  assert.equal(result.savingsCents, -packs)
  assert.equal(result.lineDeltas.length, 11)
})
