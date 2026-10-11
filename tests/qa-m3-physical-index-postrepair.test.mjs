import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Independent postrepair acceptance of every physical slot's original object
// identity. All inputs are synthetic; nothing here is retailer evidence.
function basket(store, rise = 0) {
  const products = m2Products.map(p => ({
    ...p, id: store + '-' + p.id, storeId: store, priceCents: p.priceCents + rise,
  }))
  products.push({ id: store + '-garam', storeId: store, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + rise, available: true })
  const out = buildOneStoreBasket({
    store: { id: store, name: store }, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(out.lines.length, 11)
  assert.equal(out.matchedLineCount, 11)
  return out
}
function pair(rise = 0) {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', rise) }
}
function protectSlots(data, side, positions, shift) {
  const original = data[side].lines
  const [first, second] = positions
  const reads = new Map()
  let propertyGets = 0
  let descriptorGets = 0
  data[side].lines = new Proxy(original, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
      if (typeof key !== 'string' || !Number.isInteger(Number(key)) ||
          String(Number(key)) !== key) return descriptor
      descriptorGets++
      const count = (reads.get(key) ?? 0) + 1
      reads.set(key, count)
      if (!shift || count === 1 || (key !== String(first) && key !== String(second))) {
        return descriptor
      }
      return { ...descriptor, value: key === String(first)
        ? target[second] : target[first] }
    },
    get(target, key, receiver) {
      if (typeof key === 'string' && Number.isInteger(Number(key)) &&
          String(Number(key)) === key) {
        propertyGets++
        throw new Error('caller array indexed GET forbidden')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  return {
    reads, get propertyGets() { return propertyGets },
    get descriptorGets() { return descriptorGets },
  }
}
function assertUnknown(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}
for (const side of ['baseline', 'candidate']) {
  for (const positions of [[0, 10], [3, 6]]) {
    test(side + ' cannot swap preflighted row references at ' + positions, () => {
      const data = pair()
      const spy = protectSlots(data, side, positions, true)
      assertUnknown(compareFullBaskets(data))
      assert.equal(spy.reads.get(String(positions[0])), 2)
      assert.equal(spy.propertyGets, 0)
      assert.ok(spy.descriptorGets >= 12)
    })
  }
  test(side + ' can use a stable all-slot own-descriptor Proxy', () => {
    const data = pair()
    const spy = protectSlots(data, side, [0, 10], false)
    const out = compareFullBaskets(data)
    assert.equal(out.outcome, 'same')
    assert.equal(out.claimable, true)
    assert.equal(out.savingsCents, 0)
    assert.equal(out.lineDeltas.length, 11)
    assert.equal(spy.descriptorGets, 22)
    assert.equal(spy.propertyGets, 0)
  })
}
test('stable two-store indexed proxies preserve physical weighted price rise', () => {
  const data = pair(1)
  const baseSpy = protectSlots(data, 'baseline', [0, 1], false)
  const candidateSpy = protectSlots(data, 'candidate', [0, 1], false)
  const full = basket('qa-plus')
  const packs = full.lines.reduce((total, row) => total + row.packs, 0)
  const out = compareFullBaskets(data)
  assert.equal(out.claimable, true)
  assert.equal(out.outcome, 'worse')
  assert.equal(out.deltaCents, packs)
  assert.equal(out.savingsCents, -packs)
  assert.equal(baseSpy.propertyGets, 0)
  assert.equal(candidateSpy.propertyGets, 0)
})
test('frozen original rows and arrays still give canonical same', () => {
  const data = pair()
  for (const side of ['baseline', 'candidate']) {
    for (const row of data[side].lines) Object.freeze(row)
    Object.freeze(data[side].lines)
  }
  const out = compareFullBaskets(data)
  assert.equal(out.claimable, true)
  assert.equal(out.outcome, 'same')
  assert.equal(out.lineDeltas.length, 11)
})
