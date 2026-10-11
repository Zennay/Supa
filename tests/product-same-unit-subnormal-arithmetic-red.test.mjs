import assert from 'node:assert/strict'
import test from 'node:test'

import { aggregatePlanIngredients } from '../src/domain/basket.ts'
import {
  sumDecimalAmounts,
  sumDecimalDemandUnits,
} from '../src/domain/decimalPackArithmetic.ts'

// Controlled arithmetic regression for the existing #1402 mixed-unit work.
// These are NOT real grocery quantities, observed prices, or M3 field evidence.
// A valid positive JS-number sum must not be discarded because an intermediate
// Number(10n ** 310n) overflows to Infinity.
const representable = [
  [1e-310, 1e-310, 2e-310],
  [Number.MIN_VALUE, Number.MIN_VALUE, 1e-323],
  [1e-308, 1e-308, 2e-308],
  [0.1, 0.2, 0.3],
]

test('same-unit decimal aggregation agrees with representable cross-unit arithmetic', () => {
  for (const [first, second, expected] of representable) {
    assert.equal(
      sumDecimalDemandUnits([
        { amount: first, unit: 'g' },
        { amount: second, unit: 'g' },
      ], 'g'),
      expected,
      'exact unit conversion reference for ' + String(first),
    )
    assert.equal(
      sumDecimalAmounts([first, second]),
      expected,
      'same-unit round trip for ' + String(first),
    )
    assert.equal(
      sumDecimalAmounts([second, first]),
      expected,
      'same-unit permutation for ' + String(first),
    )
  }
})

test('planner must not lose an exactly representable small same-unit demand', () => {
  const common = { id: 'rice', label: 'Rijst', query: 'rijst', unit: 'g' }
  const recipes = [0, 1].map((index) => ({
    id: 'recipe-' + index, title: 'Synthetic ' + index,
    minutes: 10, servings: 1, estimatedCost: 1, tags: [],
    ingredients: [{ ...common, amount: 1e-310 }],
  }))
  const plan = recipes.map((r, i) => ({ day: 'day-' + i, recipeId: r.id }))
  const input = { plan, recipes, activeDays: plan.map((entry) => entry.day) }
  const before = structuredClone(input)
  const actual = aggregatePlanIngredients(input.plan, input.recipes, input.activeDays)
  assert.equal(actual.length, 1)
  assert.equal(actual[0].unit, 'g')
  assert.equal(actual[0].amount, 2e-310)
  assert.deepEqual(input, before, 'aggregation must not mutate caller recipes or plan')
})
