import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Isolated synthetic 11-demand M3 resource boundary; NO retailer observations.
function build(storeId, rise = 0) {
  const products = m2Products.map(p => ({
    ...p, id: storeId + '-' + p.id, storeId,
    priceCents: p.priceCents + rise,
  }))
  products.push({
    id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + rise, available: true,
  })
  const b = buildOneStoreBasket({ store: { id: storeId, name: storeId },
    plan: m2InitialPlan, activeDays: m2DefaultActiveDays,
    recipes: m2Recipes, products })
  assert.equal(b.lines.length, 11)
  return b
}
const pair = inc => ({ baseline: build('qa-plus'), candidate: build('qa-deka', inc ?? 0) })
function changingArray(lines, grownLength) {
  let lengthReads = 0
  const expandedReads = []
  const proxy = new Proxy(lines, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'length') {
        lengthReads += 1
        if (lengthReads === 2) target.length = grownLength
        return Reflect.getOwnPropertyDescriptor(target, key)
      }
      if (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key)) {
        const index = Number(key)
        if (index >= 11) {
          expandedReads.push(index)
          if (expandedReads.length > 6) throw Error('bounded test probe: no large loop')
          return { value: target[0], configurable: true, enumerable: true, writable: true }
        }
      }
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })
  return { proxy, get lengthReads() { return lengthReads }, expandedReads }
}
function unknown(value) {
  assert.equal(value.claimable, false)
  assert.equal(value.outcome, 'unknown')
  assert.equal(value.deltaCents, null)
  assert.equal(value.savingsCents, null)
  assert.deepEqual(value.lineDeltas, [])
}

test('M3 cannot visit post-preflight expanded 10001-slot Proxy basket indexes [RED]', () => {
  for (const side of ['baseline', 'candidate']) {
    const data = pair()
    const spy = changingArray(data[side].lines, 10_001)
    data[side].lines = spy.proxy
    unknown(compareFullBaskets(data))
    assert.equal(spy.lengthReads, 2)
    assert.deepEqual(spy.expandedReads, [], side)
  }
})

test('M3 cannot visit post-preflight expanded 100000-slot Proxy basket indexes [RED]', () => {
  const data = pair()
  const spy = changingArray(data.candidate.lines, 100_000)
  data.candidate.lines = spy.proxy
  unknown(compareFullBaskets(data))
  assert.equal(spy.lengthReads, 2)
  assert.deepEqual(spy.expandedReads, [])
})

test('static 10001-slot plain and Proxy arrays are rejected before any indexed descriptors', () => {
  for (const side of ['baseline', 'candidate']) {
    const data = pair()
    const array = new Array(10_001)
    let probes = 0
    data[side].lines = new Proxy(array, {
      getOwnPropertyDescriptor(target, key) {
        if (typeof key === 'string' && /^\d+$/.test(key)) probes += 1
        return Reflect.getOwnPropertyDescriptor(target, key)
      },
    })
    unknown(compareFullBaskets(data))
    assert.equal(probes, 0)
  }
})

test('frozen 11-demand complete baskets remain exact and claimable', () => {
  const data = pair()
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const r = compareFullBaskets(data)
  assert.equal(r.claimable, true)
  assert.equal(r.outcome, 'same')
  assert.equal(r.savingsCents, 0)
  assert.equal(r.lineDeltas.length, 11)
})

test('legitimate +1-cent per physical pack is still accurately worse', () => {
  const data = pair(1)
  const packs = data.baseline.lines.reduce((sum, line) => sum + line.packs, 0)
  const r = compareFullBaskets(data)
  assert.equal(r.claimable, true)
  assert.equal(r.outcome, 'worse')
  assert.equal(r.deltaCents, packs)
  assert.equal(r.savingsCents, -packs)
})
