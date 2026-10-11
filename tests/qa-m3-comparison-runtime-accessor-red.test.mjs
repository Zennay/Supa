import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'

// Controlled synthetic prices only: no retailer observation or M3 savings claim.
function basket(storeId) {
  const result = buildOneStoreBasket({
    store: { id: storeId, name: storeId },
    plan: [{ day: 'Ma', recipeId: 'rijst' }], activeDays: ['Ma'],
    recipes: [{
      id: 'rijst', title: 'Rijst', minutes: 10, servings: 1,
      tags: [], estimatedCost: 1.2,
      ingredients: [{ id: 'rice', label: 'Rijst', query: 'rijst', amount: 200, unit: 'g' }],
    }],
    products: [{
      id: storeId + '-rice', storeId, name: 'Rijst', packAmount: 500,
      packUnit: 'g', priceCents: 129, available: true,
    }],
  })
  assert.equal(result.matchedLineCount, 1)
  assert.equal(result.unresolvedLineCount, 0)
  return result
}
function pair() {
  return { baseline: basket('test-plus'), candidate: basket('test-dekamarkt') }
}
function unknown(input) {
  const result = assert.doesNotThrow(() => compareFullBaskets(input))
  // assert.doesNotThrow returns undefined; call separately only after checking no throw.
  const comparison = compareFullBaskets(input)
  assert.equal(comparison.claimable, false)
  assert.equal(comparison.outcome, 'unknown')
  assert.equal(comparison.savingsCents, null)
  assert.equal(comparison.deltaCents, null)
  assert.deepEqual(comparison.lineDeltas, [])
  assert.ok(comparison.reasons.length >= 1)
}

test('revoked root basket cannot crash M3 financial comparison', () => {
  const data = pair()
  const { proxy, revoke } = Proxy.revocable(data.baseline, {})
  revoke()
  unknown({ baseline: proxy, candidate: data.candidate })
})

test('revoked physical line array cannot crash M3 financial comparison', () => {
  const data = pair()
  const { proxy, revoke } = Proxy.revocable(data.candidate.lines, {})
  revoke()
  unknown({ baseline: data.baseline, candidate: { ...data.candidate, lines: proxy } })
})

test('revoked matched line cannot crash the M3 own-data guard', () => {
  const data = pair()
  const { proxy, revoke } = Proxy.revocable(data.candidate.lines[0], {})
  revoke()
  data.candidate.lines = [proxy]
  unknown(data)
})

test('root basket lines getter must never run', () => {
  const data = pair()
  let getterCalls = 0
  Object.defineProperty(data.baseline, 'lines', {
    enumerable: true, configurable: true,
    get() { getterCalls++; throw Error('hostile root basket lines getter') },
  })
  unknown(data)
  assert.equal(getterCalls, 0)
})

test('store ID getter must never run', () => {
  const data = pair()
  let getterCalls = 0
  Object.defineProperty(data.candidate.store, 'id', {
    enumerable: true, configurable: true,
    get() { getterCalls++; throw Error('hostile store ID getter') },
  })
  unknown(data)
  assert.equal(getterCalls, 0)
})

test('physical array index getter must never run', () => {
  const data = pair()
  let getterCalls = 0
  Object.defineProperty(data.baseline.lines, '0', {
    enumerable: true, configurable: true,
    get() { getterCalls++; throw Error('hostile physical index getter') },
  })
  unknown(data)
  assert.equal(getterCalls, 0)
})

test('own matched-line pack and price getters must never run', () => {
  for (const key of ['pack', 'pricePerPackCents', 'status']) {
    const data = pair()
    let getterCalls = 0
    Object.defineProperty(data.baseline.lines[0], key, {
      enumerable: true, configurable: true,
      get() { getterCalls++; throw Error('hostile matched ' + key + ' getter') },
    })
    unknown(data)
    assert.equal(getterCalls, 0)
  }
})

test('nested owned requirement amount and pack count getters must never run', () => {
  for (const [outer, key] of [['requirement', 'amount'], ['pack', 'count']]) {
    const data = pair()
    let getterCalls = 0
    Object.defineProperty(data.candidate.lines[0][outer], key, {
      enumerable: true, configurable: true,
      get() { getterCalls++; throw Error('hostile nested ' + key + ' getter') },
    })
    unknown(data)
    assert.equal(getterCalls, 0)
  }
})

test('normal frozen, own-data baskets still compare exactly without mutation', () => {
  const data = pair()
  for (const value of [data.baseline, data.candidate]) {
    Object.freeze(value.store)
    for (const line of value.lines) {
      Object.freeze(line.pack)
      Object.freeze(line.requirement)
      Object.freeze(line)
    }
    Object.freeze(value.lines)
    Object.freeze(value)
  }
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.deltaCents, 0)
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 1)
})
