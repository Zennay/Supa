import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregatePlanIngredients } from '../src/domain/basket.ts'
import { calculateDecimalPackCount, sumDecimalAmounts } from '../src/domain/decimalPackArithmetic.ts'

// Controlled decimal arithmetic, NOT genuine observed store quantities/prices.
function repeatedIngredient(left, right) {
  const plan = [{ day: 'Ma', recipeId: 'a' }, { day: 'Di', recipeId: 'b' }]
  const recipes = [left, right].map((amount, index) => ({
    id: index === 0 ? 'a' : 'b', title: 'Controlled recipe', minutes: 10,
    servings: 1, estimatedCost: 1, tags: [],
    ingredients: [{ id: 'same', label: 'Controlled ingredient', query: 'controlled ingredient', amount, unit: 'g' }],
  }))
  return aggregatePlanIngredients(plan, recipes, ['Ma', 'Di'])
}

test('same-unit minimal subnormal decimal demands sum to an exactly representable result', () => {
  assert.equal(sumDecimalAmounts([5e-324, 5e-324]), 1e-323)
})

test('same-unit 1e-309 demands do not falsely become unresolved from denominator overflow', () => {
  assert.equal(sumDecimalAmounts([1e-309, 1e-309]), 2e-309)
})

test('two controlled recipes preserve an exactly representable subnormal requirement', () => {
  const items = repeatedIngredient(5e-324, 5e-324)
  assert.equal(items.length, 1)
  assert.equal(items[0].amount, 1e-323)
  assert.equal(items[0].unit, 'g')
})

test('ordinary decimal sums and one exact pack remain canonical', () => {
  assert.equal(sumDecimalAmounts([0.1, 0.2]), 0.3)
  assert.equal(calculateDecimalPackCount(
    [{ amount: 1e-323, unit: 'g' }],
    { amount: 1e-323, unit: 'g' },
  ), 1)
  assert.equal(repeatedIngredient(0.1, 0.2)[0].amount, 0.3)
})

test('unrepresentable tiny overage and invalid amounts still abstain rather than round', () => {
  assert.equal(sumDecimalAmounts([0.1, 1e-320]), null)
  assert.equal(sumDecimalAmounts([5e-324, Infinity]), null)
  assert.equal(sumDecimalAmounts([0, 5e-324]), null)
})
