import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'

function basket(id) {
  const b = buildOneStoreBasket({
    store: { id, name: id },
    plan: [{ day: 'Ma', recipeId: 'rice' }],
    activeDays: ['Ma'],
    recipes: [{
      id: 'rice', title: 'Rijst', minutes: 10, servings: 1, tags: [], estimatedCost: 1.2,
      ingredients: [{ id: 'rice', label: 'Rijst', query: 'rijst', amount: 200, unit: 'g' }],
    }],
    products: [{ id: id + '-rice', storeId: id, name: 'Rijst',
      packAmount: 500, packUnit: 'g', priceCents: 129, available: true }],
  })
  assert.equal(b.matchedLineCount, 1)
  assert.equal(b.unresolvedLineCount, 0)
  return b
}
function pair() {
  return { baseline: basket('controlled-plus'), candidate: basket('controlled-deka') }
}
function abstains(data) {
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}
function shadowGetter(lines, method, count) {
  Object.defineProperty(lines, method, {
    configurable: true, enumerable: true,
    get() { count.reads++; throw Error('untrusted ' + method + ' accessor') },
  })
}

test('own filter accessor on baseline/candidate basket array cannot execute', () => {
  for (const side of ['baseline', 'candidate']) {
    const data = pair()
    const count = { reads: 0 }
    shadowGetter(data[side].lines, 'filter', count)
    abstains(data)
    assert.equal(count.reads, 0, side)
  }
})

test('own some accessor on baseline/candidate basket array cannot execute', () => {
  for (const side of ['baseline', 'candidate']) {
    const data = pair()
    const count = { reads: 0 }
    shadowGetter(data[side].lines, 'some', count)
    abstains(data)
    assert.equal(count.reads, 0, side)
  }
})

test('own custom callable filter cannot run and forge a trusted basket', () => {
  const data = pair()
  let calls = 0
  data.candidate.lines.filter = function forgedFilter(...args) {
    calls++
    return Array.prototype.filter.call(this, ...args)
  }
  abstains(data)
  assert.equal(calls, 0)
})

test('custom prototype filter implementation cannot run', () => {
  const data = pair()
  let calls = 0
  const prototype = Object.create(Array.prototype)
  prototype.filter = function customFilter(...args) {
    calls++
    return Array.prototype.filter.call(this, ...args)
  }
  Object.setPrototypeOf(data.baseline.lines, prototype)
  abstains(data)
  assert.equal(calls, 0)
})

test('custom inherited some getter cannot execute', () => {
  const data = pair()
  let reads = 0
  const prototype = Object.create(Array.prototype)
  Object.defineProperty(prototype, 'some', {
    configurable: true,
    get() { reads++; throw Error('inherited some getter') },
  })
  Object.setPrototypeOf(data.candidate.lines, prototype)
  abstains(data)
  assert.equal(reads, 0)
})

test('ordinary frozen dense basket arrays still compare cent-exact and without mutations', () => {
  const data = pair()
  const before = JSON.stringify(data)
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.deltaCents, 0)
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 1)
  assert.equal(JSON.stringify(data), before)
})
