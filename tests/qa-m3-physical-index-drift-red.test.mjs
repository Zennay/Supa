import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Expected RED: physical-slot descriptors may swap two *already validated*
// matched objects within one stable 11-slot array reference.
function basket(store, rise = 0) {
  const products = m2Products.map(p => ({
    ...p, id: store + '-' + p.id, storeId: store, priceCents: p.priceCents + rise,
  }))
  products.push({ id: store + '-garam', storeId: store, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + rise, available: true })
  const b = buildOneStoreBasket({
    store: { id: store, name: store }, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(b.lines.length, 11)
  assert.equal(b.matchedLineCount, 11)
  assert.equal(b.unresolvedLineCount, 0)
  return b
}
function pair(rise = 0) {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', rise) }
}
function guardedSlots(data, side, swap) {
  const raw = data[side].lines
  assert.equal(raw[0].status, 'matched')
  assert.equal(raw[1].status, 'matched')
  let firstReads = 0
  let secondReads = 0
  let indexedGets = 0
  data[side].lines = new Proxy(raw, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
      if (key !== '0' && key !== '1') return descriptor
      if (key === '0') firstReads++
      else secondReads++
      const reads = key === '0' ? firstReads : secondReads
      if (!swap || reads === 1) return descriptor
      return { ...descriptor, value: key === '0' ? raw[1] : raw[0] }
    },
    get(target, key, receiver) {
      if (key === '0' || key === '1') {
        indexedGets++
        throw new Error('ordinary indexed row GET is not allowed')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  return {
    get firstReads() { return firstReads },
    get secondReads() { return secondReads },
    get indexedGets() { return indexedGets },
  }
}
function unknown(out) {
  assert.equal(out.outcome, 'unknown')
  assert.equal(out.claimable, false)
  assert.equal(out.deltaCents, null)
  assert.equal(out.savingsCents, null)
  assert.deepEqual(out.lineDeltas, [])
}
for (const side of ['baseline', 'candidate']) {
  test(side + ' physical indices 0/1 swap preflighted row references [expected RED]', () => {
    const data = pair()
    const spy = guardedSlots(data, side, true)
    unknown(compareFullBaskets(data))
    assert.equal(spy.firstReads, 2)
    assert.equal(spy.secondReads, 2)
    assert.equal(spy.indexedGets, 0)
  })
  test(side + ' stable 11-slot array descriptor Proxy remains claimable', () => {
    const data = pair()
    const spy = guardedSlots(data, side, false)
    const out = compareFullBaskets(data)
    assert.equal(out.outcome, 'same')
    assert.equal(out.claimable, true)
    assert.equal(out.lineDeltas.length, 11)
    assert.equal(out.savingsCents, 0)
    assert.equal(spy.firstReads, 2)
    assert.equal(spy.secondReads, 2)
    assert.equal(spy.indexedGets, 0)
  })
}
test('frozen equality and physical one-cent-per-pack worse stay claimable', () => {
  const equal = pair()
  Object.freeze(equal.baseline.lines)
  Object.freeze(equal.candidate.lines)
  assert.equal(compareFullBaskets(equal).outcome, 'same')
  const increased = pair(1)
  Object.freeze(increased.baseline.lines)
  Object.freeze(increased.candidate.lines)
  const packs = increased.baseline.lines.reduce((n, line) => n + line.packs, 0)
  const out = compareFullBaskets(increased)
  assert.equal(out.outcome, 'worse')
  assert.equal(out.claimable, true)
  assert.equal(out.deltaCents, packs)
  assert.equal(out.savingsCents, -packs)
})
