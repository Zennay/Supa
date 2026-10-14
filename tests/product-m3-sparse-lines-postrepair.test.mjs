import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'

function basket(id, priceCents = 199) {
  const result = buildOneStoreBasket({
    store: { id, name: id },
    plan: [{ day: 'Ma', recipeId: 'kippendij' }],
    activeDays: ['Ma'],
    recipes: [{
      id: 'kippendij', title: 'Gecontroleerde maaltijd',
      minutes: 12, servings: 1, tags: [], estimatedCost: 1.99,
      ingredients: [{
        id: 'kip', label: 'Kippendij', query: 'kippendij',
        amount: 0.07, unit: 'g',
      }],
    }],
    products: [{
      id: id + '-kip', storeId: id, name: 'Kippendij',
      packAmount: 0.01, packUnit: 'g', available: true, priceCents,
    }],
  })
  assert.equal(result.matchedLineCount, 1)
  assert.equal(result.lines[0].packs, 7)
  return result
}

function assertUnknown(result) {
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

test('postrepair: unobserved trailing array position cannot claim equal baskets', () => {
  const baseline = basket('plus')
  const candidate = basket('dekamarkt')
  const lines = baseline.lines.slice()
  lines.length = 2
  assert.equal(Object.hasOwn(lines, 1), false)
  const snapshot = { ...baseline, lines }
  const original = JSON.stringify(snapshot)
  assertUnknown(compareFullBaskets({ baseline: snapshot, candidate }))
  assert.equal(JSON.stringify(snapshot), original)
})

test('postrepair: leading hole is rejected even with all displayed money reconciled', () => {
  const baseline = basket('plus')
  const candidate = basket('dekamarkt')
  const lines = new Array(2)
  lines[1] = candidate.lines[0]
  assert.equal(Object.hasOwn(lines, 0), false)
  assertUnknown(compareFullBaskets({ baseline, candidate: { ...candidate, lines } }))
})

test('postrepair: inherited array index cannot impersonate an owned physical basket line', () => {
  const baseline = basket('plus')
  const candidate = basket('dekamarkt')
  const lines = new Array(1)
  const prototype = Object.create(Array.prototype)
  Object.defineProperty(prototype, '0', {
    value: baseline.lines[0], configurable: true,
  })
  Object.setPrototypeOf(lines, prototype)
  assert.equal(Array.isArray(lines), true)
  assert.equal(Object.hasOwn(lines, 0), false)
  assertUnknown(compareFullBaskets({ baseline: { ...baseline, lines }, candidate }))
  assert.equal(Object.hasOwn(baseline.lines, 0), true)
})

test('postrepair: dense priced baskets still produce an exact worse comparison', () => {
  const baseline = basket('plus')
  const candidate = basket('dekamarkt', 200)
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, 7)
  assert.equal(result.savingsCents, -7)
  assert.equal(result.lineDeltas.length, 1)
})

test('postrepair: dense explicit invalid rows still fail closed', () => {
  const baseline = basket('plus')
  const candidate = basket('dekamarkt')
  for (const value of [null, undefined, { status: 'forged' }]) {
    const lines = [baseline.lines[0], value]
    assert.equal(Object.hasOwn(lines, 1), true)
    assertUnknown(compareFullBaskets({ baseline: { ...baseline, lines }, candidate }))
  }
})

test('postrepair: valid decimal pack economics cannot hide stale total cents', () => {
  const baseline = basket('plus')
  const candidate = basket('dekamarkt')
  const tampered = { ...baseline, totalCents: baseline.totalCents + 1 }
  assertUnknown(compareFullBaskets({ baseline: tampered, candidate }))
})
