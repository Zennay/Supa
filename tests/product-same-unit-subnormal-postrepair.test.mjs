import assert from 'node:assert/strict'
import test from 'node:test'

import { aggregatePlanIngredients } from '../src/domain/basket.ts'
import { sumDecimalAmounts } from '../src/domain/decimalPackArithmetic.ts'

// Independent black-box acceptance stacked AFTER the narrow #1402 fix.
// Synthetic edge cases validate arithmetic safety; they are not retailer prices.
const tinyPairs = [
  [1e-310, 2e-310],
  [1e-315, 2e-315],
  [1e-320, 2e-320],
  [1e-323, 2e-323],
  [Number.MIN_VALUE, 1e-323],
]

test('independent: subnormal same-unit pairs round-trip and are order invariant', () => {
  for (const [amount, twice] of tinyPairs) {
    assert.equal(sumDecimalAmounts([amount, amount]), twice, String(amount))
    assert.equal(sumDecimalAmounts([amount, amount, amount]), twice + amount, 'triple ' + String(amount))
  }
  assert.equal(sumDecimalAmounts([1e-310, 1e-315]), 1.00001e-310)
  assert.equal(sumDecimalAmounts([1e-315, 1e-310]), 1.00001e-310)
})

test('independent: do not round away a nonrepresentable tiny addition', () => {
  assert.equal(sumDecimalAmounts([0.1, Number.MIN_VALUE]), null)
  assert.equal(sumDecimalAmounts([Number.MIN_VALUE, 0.1]), null)
  assert.equal(sumDecimalAmounts([0.1, 0.2]), 0.3)
  assert.equal(sumDecimalAmounts([0.2, 0.1]), 0.3)
  assert.equal(sumDecimalAmounts([]), null)
  assert.equal(sumDecimalAmounts([0]), null)
})

test('independent: recipe order cannot delete two physical positive demands', () => {
  for (const reversed of [false, true]) {
    const amounts = reversed ? [1e-315, 1e-310] : [1e-310, 1e-315]
    const recipes = amounts.map((amount, index) => ({
      id: 'recipe-' + index,
      title: 'Controlled recipe ' + index,
      minutes: 10, servings: 1, tags: [], estimatedCost: 0,
      ingredients: [{
        id: 'basmati-rice', label: 'Basmati rijst', query: 'basmati rijst',
        amount, unit: 'g',
      }],
    }))
    const plan = recipes.map((recipe, index) => ({
      day: 'day-' + index, recipeId: recipe.id,
    }))
    const activeDays = plan.map((entry) => entry.day)
    const copy = structuredClone({ plan, recipes, activeDays })
    const actual = aggregatePlanIngredients(plan, recipes, activeDays)
    assert.equal(actual.length, 1)
    assert.equal(actual[0].amount, 1.00001e-310)
    assert.equal(actual[0].unit, 'g')
    assert.deepEqual({ plan, recipes, activeDays }, copy)
  }
})
