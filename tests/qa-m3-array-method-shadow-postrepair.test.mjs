import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Real canonical M2 demand, synthetic store prices. Not field M3 observation.
function makeBasket(id, inc = 0) {
  const products = m2Products.map(product => ({
    ...product, id: id + '-' + product.id, storeId: id,
    priceCents: product.priceCents + inc,
  }))
  products.push({ id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + inc, available: true })
  const result = buildOneStoreBasket({
    store: { id, name: id }, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.matchedLineCount, 11)
  assert.equal(result.unresolvedLineCount, 0)
  return result
}
function pair(inc = 0) {
  return { baseline: makeBasket('plus-controlled'), candidate: makeBasket('deka-controlled', inc) }
}
function unknown(input) {
  const result = compareFullBaskets(input)
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

test('postrepair own filter or some accessor never executes for either store', () => {
  for (const method of ['filter', 'some']) {
    for (const side of ['baseline', 'candidate']) {
      const data = pair()
      let reads = 0
      Object.defineProperty(data[side].lines, method, {
        configurable: true,
        get() { reads++; throw Error('unsafe method ' + method) },
      })
      unknown(data)
      assert.equal(reads, 0, side + ':' + method)
    }
  }
})

test('postrepair own callable method cannot forge matched lines or totals', () => {
  for (const method of ['filter', 'some']) {
    const data = pair()
    let calls = 0
    data.baseline.lines[method] = () => { calls++; return [] }
    unknown(data)
    assert.equal(calls, 0, method)
  }
})

test('postrepair inherited custom method override cannot execute', () => {
  for (const method of ['filter', 'some']) {
    const data = pair()
    let calls = 0
    const proto = Object.create(Array.prototype)
    proto[method] = (...args) => {
      calls++
      return Array.prototype[method].call(data.candidate.lines, ...args)
    }
    Object.setPrototypeOf(data.candidate.lines, proto)
    unknown(data)
    assert.equal(calls, 0)
  }
})

test('postrepair inherited getter cannot execute', () => {
  const data = pair()
  let reads = 0
  const proto = Object.create(Array.prototype)
  Object.defineProperty(proto, 'filter', {
    get() { reads++; throw Error('inherited hostile filter') },
  })
  Object.setPrototypeOf(data.baseline.lines, proto)
  unknown(data)
  assert.equal(reads, 0)
})

test('postrepair ordinary frozen 11-demand basket remains exactly same', () => {
  const data = pair()
  const before = JSON.stringify(data)
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
  assert.equal(JSON.stringify(data), before)
})

test('postrepair ordinary 11-demand price-only cent increase stays weighted', () => {
  const data = pair(1)
  const expected = data.baseline.lines.reduce((sum, line) => sum + line.packs, 0)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, expected)
  assert.equal(result.savingsCents, -expected)
})
