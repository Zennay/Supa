import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Independent postrepair acceptance for #1408. Four meals, eleven demands,
// synthetic pack prices: no retailer data or genuine M3 evidence.
function oneStore(id, increment = 0, withGaram = true) {
  const products = m2Products.map(p => ({
    ...p, id: id + '-' + p.id, storeId: id, priceCents: p.priceCents + increment,
  }))
  if (withGaram) products.push({
    id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    available: true, packAmount: 50, packUnit: 'g', priceCents: 139 + increment,
  })
  const basket = buildOneStoreBasket({
    store: { id, name: id }, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(basket.lines.length, 11)
  return basket
}
const pair = (inc = 0) => ({
  baseline: oneStore('synthetic-plus'),
  candidate: oneStore('synthetic-deka', inc),
})
function guardedProxy(array, override = {}) {
  const visited = []
  const proxy = new Proxy(array, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^(?:0|[1-9][0-9]*)$/.test(key) ||
          ['length', 'filter', 'some', 'map', 'reduce', 'find'].includes(key) ||
          key === Symbol.iterator) {
        visited.push(String(key))
        if (key in override) return override[key]
        throw Error('caller array GET forbidden: ' + String(key))
      }
      return Reflect.get(target, key, receiver)
    },
  })
  return { proxy, visited }
}
function unknown(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

test('independent: fully frozen 11-demand Array Proxy never invokes indexed or method GET', () => {
  for (const side of ['baseline', 'candidate']) {
    const data = pair()
    Object.freeze(data[side].lines)
    const trap = guardedProxy(data[side].lines)
    data[side].lines = trap.proxy
    const result = compareFullBaskets(data)
    assert.equal(result.outcome, 'same')
    assert.equal(result.claimable, true)
    assert.equal(result.lineDeltas.length, 11)
    assert.equal(result.savingsCents, 0)
    assert.deepEqual(trap.visited, [], side)
  }
})

test('independent: forged method and length getters cannot cause fake equal basket', () => {
  const data = pair(1)
  const expected = data.baseline.lines.reduce((sum, item) => sum + item.packs, 0)
  const trap = guardedProxy(data.candidate.lines, {
    filter: () => [],
    some: () => false,
    map: () => [],
    length: 0,
  })
  data.candidate.lines = trap.proxy
  const result = compareFullBaskets(data)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.claimable, true)
  assert.equal(result.deltaCents, expected)
  assert.equal(result.savingsCents, -expected)
  assert.deepEqual(trap.visited, [])
})

test('independent: missing ingredient still yields unknown despite hostile array GET', () => {
  const data = pair()
  data.candidate = oneStore('synthetic-deka', 0, false)
  const trap = guardedProxy(data.candidate.lines)
  data.candidate.lines = trap.proxy
  unknown(compareFullBaskets(data))
  assert.deepEqual(trap.visited, [])
})

test('independent: revoked array Proxy is safely unknown without leaking money', () => {
  const data = pair()
  const { proxy, revoke } = Proxy.revocable(data.baseline.lines, {})
  revoke()
  data.baseline.lines = proxy
  unknown(compareFullBaskets(data))
})

test('independent: descriptor trap failure never generates a financial claim', () => {
  const data = pair()
  const proxy = new Proxy(data.candidate.lines, {
    getOwnPropertyDescriptor() { throw Error('untrusted descriptor') },
  })
  data.candidate.lines = proxy
  unknown(compareFullBaskets(data))
})
