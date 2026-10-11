import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Independent synthetic QA for M3 physical limit, no retailer observations.
function storeBasket(id, inc = 0) {
  const products = m2Products.map(p => ({ ...p,
    id: id + '-' + p.id, storeId: id, priceCents: p.priceCents + inc }))
  products.push({ id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + inc, available: true })
  const result = buildOneStoreBasket({ store: { id, name: id },
    plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products })
  assert.equal(result.lines.length, 11)
  return result
}
const pair = (inc = 0) => ({
  baseline: storeBasket('synthetic-PLUS'),
  candidate: storeBasket('synthetic-DEKA', inc),
})
function oversizedProxy(length) {
  const positions = []
  const lines = new Array(length)
  const proxy = new Proxy(lines, {
    getOwnPropertyDescriptor(target, key) {
      if (typeof key === 'string' && /^(?:0|[1-9][0-9]*)$/.test(key)) {
        positions.push(key)
        throw Error('unsafe slot scan')
      }
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })
  return { proxy, positions }
}
function nonclaimable(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.savingsCents, null)
  assert.equal(result.deltaCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

test('postrepair exact 10001 slots exceed the explicit 10000 physical bound without scans', () => {
  for (const side of ['baseline', 'candidate']) {
    const data = pair()
    const trap = oversizedProxy(10_001)
    data[side].lines = trap.proxy
    nonclaimable(compareFullBaskets(data))
    assert.deepEqual(trap.positions, [], side)
  }
})

test('postrepair much larger length also rejected before any indexed descriptor', () => {
  const data = pair()
  const huge = oversizedProxy(2_000_000)
  data.candidate.lines = huge.proxy
  nonclaimable(compareFullBaskets(data))
  assert.deepEqual(huge.positions, [])
})

test('postrepair nominal under-bound sparse arrays still fail closed', () => {
  const data = pair()
  data.baseline.lines = Array(9999)
  nonclaimable(compareFullBaskets(data))
})

test('postrepair controlled 11-demand frozen baseline/candidate still compare same', () => {
  const data = pair()
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
})

test('postrepair +1-cent synthetic price rise remains pack-weighted worse', () => {
  const data = pair(1)
  const expected = data.baseline.lines.reduce((sum, line) => sum + line.packs, 0)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, expected)
  assert.equal(result.savingsCents, -expected)
})
