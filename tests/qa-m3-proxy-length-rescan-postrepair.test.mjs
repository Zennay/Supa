import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Synthetic four-meal/11-demand M3 quality gate; no retailer evidence.
function basket(id, centRise = 0) {
  const products = m2Products.map(p => ({
    ...p, id: id + '-' + p.id, storeId: id, priceCents: p.priceCents + centRise,
  }))
  products.push({ id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', available: true, priceCents: 139 + centRise })
  const result = buildOneStoreBasket({ store: { id, name: id },
    plan: m2InitialPlan, activeDays: m2DefaultActiveDays,
    recipes: m2Recipes, products })
  assert.equal(result.lines.length, 11)
  return result
}
const pair = increase => ({ baseline: basket('qa-plus'), candidate: basket('qa-deka', increase ?? 0) })
function changingLength(array, newLength) {
  const extra = []
  let reads = 0
  const proxy = new Proxy(array, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'length') {
        ++reads
        if (reads === 2) target.length = newLength
        return Reflect.getOwnPropertyDescriptor(target, key)
      }
      if (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key)) {
        if (Number(key) >= 11) {
          extra.push(key)
          if (extra.length > 4) throw Error('test guard: loop into expanded region')
          return { value: target[0], enumerable: true, writable: true, configurable: true }
        }
      }
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })
  return { proxy, extra, get reads() { return reads } }
}
function abstain(value) {
  assert.equal(value.claimable, false)
  assert.equal(value.outcome, 'unknown')
  assert.equal(value.savingsCents, null)
  assert.equal(value.deltaCents, null)
  assert.deepEqual(value.lineDeltas, [])
}

test('independent recheck prevents new descriptor probes when baseline/candidate jumps to 10001', () => {
  for (const side of ['baseline', 'candidate']) {
    const data = pair()
    const trap = changingLength(data[side].lines, 10_001)
    data[side].lines = trap.proxy
    abstain(compareFullBaskets(data))
    assert.equal(trap.reads, 2)
    assert.deepEqual(trap.extra, [])
  }
})

test('independent recheck rejects huge post-validation jump without scanning', () => {
  for (const jump of [25_000, 1_000_000]) {
    const data = pair()
    const trap = changingLength(data.candidate.lines, jump)
    data.candidate.lines = trap.proxy
    abstain(compareFullBaskets(data))
    assert.equal(trap.reads, 2)
    assert.deepEqual(trap.extra, [])
  }
})

test('a stable descriptor-backed 11-slot Proxy remains claimable and exact', () => {
  const data = pair()
  const spy = changingLength(data.baseline.lines, 11)
  data.baseline.lines = spy.proxy
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.lineDeltas.length, 11)
  assert.equal(result.savingsCents, 0)
  assert.equal(spy.reads, 2)
  assert.deepEqual(spy.extra, [])
})

test('static oversize physical line arrays remain unknown', () => {
  const data = pair()
  data.baseline.lines = new Array(10_001)
  abstain(compareFullBaskets(data))
})

test('frozen standard arrays keep all 11 matched rows', () => {
  const data = pair()
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.lineDeltas.length, 11)
  assert.equal(result.savingsCents, 0)
})

test('candidate +1-cent per physical pack retains precise financial worsening', () => {
  const data = pair(1)
  const packSum = data.baseline.lines.reduce((sum, line) => sum + line.packs, 0)
  const outcome = compareFullBaskets(data)
  assert.equal(outcome.claimable, true)
  assert.equal(outcome.outcome, 'worse')
  assert.equal(outcome.deltaCents, packSum)
  assert.equal(outcome.savingsCents, -packSum)
})
