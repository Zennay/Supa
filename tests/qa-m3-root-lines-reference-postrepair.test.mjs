import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Independent postrepair: same row object set does NOT make two array references identical.
// Controlled four-meal/eleven-demand data only, never a retailer field observation.
function basket(id, rise = 0) {
  const products = m2Products.map(p => ({
    ...p, id: id + '-' + p.id, storeId: id, priceCents: p.priceCents + rise,
  }))
  products.push({ id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + rise, available: true })
  const b = buildOneStoreBasket({
    store: { id, name: id }, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(b.lines.length, 11)
  assert.equal(b.matchedLineCount, 11)
  return b
}
function pair(rise = 0) {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', rise) }
}
function withArrayDescriptor(data, side, changeAt) {
  const source = data[side]
  const original = source.lines
  const swapped = [...original]
  let shadowGets = 0
  let indexProbes = 0
  // The swapped array is disallowed by preflight even with every original row.
  Object.defineProperty(swapped, 'some', {
    configurable: true,
    get() {
      shadowGets++
      throw new Error('never invoke array shadow accessor')
    },
  })
  const other = new Proxy(swapped, {
    getOwnPropertyDescriptor(target, key) {
      if (typeof key === 'string' && /^\\d+$/.test(key)) indexProbes++
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })
  let reads = 0
  let ordinaryGets = 0
  data[side] = new Proxy(source, {
    getOwnPropertyDescriptor(target, key) {
      const own = Reflect.getOwnPropertyDescriptor(target, key)
      if (key === 'lines') {
        reads++
        return { ...own, value: reads >= changeAt ? other : original }
      }
      return own
    },
    get(target, key, receiver) {
      if (key === 'lines') {
        ordinaryGets++
        throw new Error('runtime basket lines GET forbidden')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  return {
    get reads() { return reads },
    get indexProbes() { return indexProbes },
    get shadowGets() { return shadowGets },
    get ordinaryGets() { return ordinaryGets },
  }
}
function failsClosed(out) {
  assert.equal(out.outcome, 'unknown')
  assert.equal(out.claimable, false)
  assert.equal(out.deltaCents, null)
  assert.equal(out.savingsCents, null)
  assert.deepEqual(out.lineDeltas, [])
}
for (const side of ['baseline', 'candidate']) {
  for (const changeAt of [2, 3]) {
    test(side + ' swapped 11-slot lines at descriptor read ' + changeAt + ' abstains', () => {
      const data = pair()
      const spy = withArrayDescriptor(data, side, changeAt)
      failsClosed(compareFullBaskets(data))
      assert.equal(spy.reads, changeAt)
      assert.equal(spy.indexProbes, 0)
      assert.equal(spy.shadowGets, 0)
      assert.equal(spy.ordinaryGets, 0)
    })
  }
  test(side + ' unchanged lines descriptor remains claimable', () => {
    const data = pair()
    const spy = withArrayDescriptor(data, side, Number.POSITIVE_INFINITY)
    const out = compareFullBaskets(data)
    assert.equal(out.outcome, 'same')
    assert.equal(out.claimable, true)
    assert.equal(out.savingsCents, 0)
    assert.equal(out.lineDeltas.length, 11)
    assert.equal(spy.reads, 3)
    assert.equal(spy.shadowGets, 0)
    assert.equal(spy.ordinaryGets, 0)
  })
}
test('frozen 11-demand same and physical one-cent-per-pack worse controls', () => {
  const equal = pair()
  Object.freeze(equal.baseline.lines)
  Object.freeze(equal.candidate.lines)
  const same = compareFullBaskets(equal)
  assert.equal(same.outcome, 'same')
  assert.equal(same.claimable, true)
  assert.equal(same.savingsCents, 0)
  const increased = pair(1)
  Object.freeze(increased.baseline.lines)
  Object.freeze(increased.candidate.lines)
  const physical = increased.baseline.lines.reduce((total, line) => total + line.packs, 0)
  const worse = compareFullBaskets(increased)
  assert.equal(worse.outcome, 'worse')
  assert.equal(worse.claimable, true)
  assert.equal(worse.deltaCents, physical)
  assert.equal(worse.savingsCents, -physical)
})
