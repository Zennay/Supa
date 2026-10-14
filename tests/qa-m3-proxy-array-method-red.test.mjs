import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Canonical 4-meal/11-demand M2; ALL prices and store IDs synthetic.
// No PLUS/DekaMarkt field evidence or public savings claim.
function basket(id, priceIncrement = 0) {
  const products = m2Products.map(p => ({
    ...p, id: id + '-' + p.id, storeId: id,
    priceCents: p.priceCents + priceIncrement,
  }))
  products.push({
    id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + priceIncrement, available: true,
  })
  const result = buildOneStoreBasket({
    store: { id, name: id }, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.matchedLineCount, 11)
  return result
}
function pair(increment = 0) {
  return { baseline: basket('controlled-baseline'), candidate: basket('controlled-candidate', increment) }
}
function trapMethods(lines, mode = 'throw') {
  const reads = []
  const proxy = new Proxy(lines, {
    get(target, key, receiver) {
      if (key === 'filter' || key === 'some' || key === 'map') {
        reads.push(key)
        if (mode === 'throw') throw Error('array method lookup must never occur: ' + key)
        return () => []
      }
      return Reflect.get(target, key, receiver)
    },
  })
  assert.equal(Array.isArray(proxy), true)
  assert.equal(Object.getPrototypeOf(proxy), Array.prototype)
  assert.equal(Object.hasOwn(proxy, 'filter'), false)
  return { proxy, reads }
}
function expectSame(result) {
  assert.equal(result.outcome, 'same')
  assert.equal(result.claimable, true)
  assert.equal(result.deltaCents, 0)
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
}
function expectUnknown(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

test('proxy method-only throwing get trap cannot execute on either basket', () => {
  for (const side of ['baseline', 'candidate']) {
    const data = pair()
    const { proxy, reads } = trapMethods(data[side].lines)
    data[side].lines = proxy
    expectSame(compareFullBaskets(data))
    assert.deepEqual(reads, [], side + ' accessed caller-owned array method')
  }
})

test('proxy forged callable filter/some/map cannot change a claimable exact basket', () => {
  for (const side of ['baseline', 'candidate']) {
    const data = pair()
    const { proxy, reads } = trapMethods(data[side].lines, 'forged')
    data[side].lines = proxy
    expectSame(compareFullBaskets(data))
    assert.deepEqual(reads, [], side + ' invoked untrusted filter/some/map')
  }
})

test('proxy method override cannot mask an exact pack-weighted 1-cent increase', () => {
  const data = pair(1)
  const expected = data.baseline.lines.reduce((sum, line) => sum + line.packs, 0)
  const baseline = trapMethods(data.baseline.lines, 'forged')
  const candidate = trapMethods(data.candidate.lines, 'throw')
  data.baseline.lines = baseline.proxy
  data.candidate.lines = candidate.proxy
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, expected)
  assert.equal(result.savingsCents, -expected)
  assert.deepEqual(baseline.reads, [])
  assert.deepEqual(candidate.reads, [])
})

test('physical gap remains unknown without calling proxy array methods', () => {
  const data = pair()
  delete data.baseline.lines[4]
  const trapped = trapMethods(data.baseline.lines)
  data.baseline.lines = trapped.proxy
  expectUnknown(compareFullBaskets(data))
  assert.deepEqual(trapped.reads, [])
})

test('real own method override remains rejected; frozen ordinary 11-demand pair stays valid', () => {
  const unsafe = pair()
  let calls = 0
  unsafe.baseline.lines.filter = () => { calls++; return [] }
  expectUnknown(compareFullBaskets(unsafe))
  assert.equal(calls, 0)

  const control = pair()
  Object.freeze(control.baseline.lines)
  Object.freeze(control.candidate.lines)
  expectSame(compareFullBaskets(control))
})
