import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'

function basket(storeId) {
  const result = buildOneStoreBasket({
    store: { id: storeId, name: storeId },
    plan: [{ day: 'Ma', recipeId: 'chicken' }],
    activeDays: ['Ma'],
    recipes: [{
      id: 'chicken', title: 'Kipmaaltijd', minutes: 10, servings: 1,
      estimatedCost: 1.99, tags: [],
      ingredients: [{
        id: 'chicken-thigh', label: 'Kippendij', query: 'kippendij',
        amount: 0.07, unit: 'g',
      }],
    }],
    products: [{
      id: storeId + '-chicken', storeId, name: 'Kippendij',
      packAmount: 0.01, packUnit: 'g', available: true, priceCents: 199,
    }],
  })
  assert.equal(result.matchedLineCount, 1)
  assert.equal(result.unresolvedLineCount, 0)
  assert.equal(result.lines.length, 1)
  return result
}

function assertUnknown(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

test('a trailing sparse shopping line cannot produce a trusted financial outcome [RED]', () => {
  const baseline = basket('controlled-plus')
  const candidate = basket('controlled-dekamarkt')
  const lines = baseline.lines.slice()
  lines.length = 2
  assert.equal(Object.hasOwn(lines, 1), false)
  const malformed = { ...baseline, lines }
  const before = JSON.stringify({ malformed, candidate })
  assertUnknown(compareFullBaskets({ baseline: malformed, candidate }))
  assert.equal(JSON.stringify({ malformed, candidate }), before)
})

test('a leading sparse slot cannot silently disappear from a candidate basket [RED]', () => {
  const baseline = basket('controlled-plus')
  const candidate = basket('controlled-dekamarkt')
  const lines = Array(2)
  lines[1] = candidate.lines[0]
  assert.equal(Object.hasOwn(lines, 0), false)
  assert.equal(lines.length, 2)
  assertUnknown(compareFullBaskets({
    baseline,
    candidate: { ...candidate, lines },
  }))
})

test('a dense fully priced single-line week remains a valid comparison [control]', () => {
  const baseline = basket('controlled-plus')
  const candidate = basket('controlled-dekamarkt')
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.deltaCents, 0)
  assert.equal(result.lineDeltas.length, 1)
})

test('a dense undefined line already fails closed [control]', () => {
  const baseline = basket('controlled-plus')
  const candidate = basket('controlled-dekamarkt')
  const lines = [...baseline.lines, undefined]
  assert.equal(Object.hasOwn(lines, 1), true)
  assertUnknown(compareFullBaskets({ baseline: { ...baseline, lines }, candidate }))
})
