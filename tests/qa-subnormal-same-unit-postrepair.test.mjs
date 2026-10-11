import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { calculateDecimalPackCount, sumDecimalAmounts, sumDecimalDemandUnits } from '../src/domain/decimalPackArithmetic.ts'

// Separate postrepair acceptance #1412. Tiny quantities and prices are synthetic.
function tinyBasket(amounts, packAmount = 1e-323) {
  const activeDays = amounts.map((_, i) => 'day-' + i)
  const plan = activeDays.map((day, i) => ({ day, recipeId: 'recipe-' + i }))
  const recipes = amounts.map((amount, i) => ({
    id: 'recipe-' + i, title: 'Synthetic', minutes: 1, servings: 1, tags: [], estimatedCost: 1,
    ingredients: [{ id: 'ingredient', label: 'Tiny ingredient', query: 'tiny ingredient', amount, unit: 'g' }],
  }))
  const result = buildOneStoreBasket({
    store: { id: 'test-shop', name: 'Controlled shop' },
    plan, activeDays, recipes, products: [{
      id: 'tiny-pack', storeId: 'test-shop', name: 'Tiny ingredient',
      packAmount, packUnit: 'g', priceCents: 249, available: true,
    }],
  })
  assert.equal(result.lines.length, 1)
  return result
}

test('independent: two minimum positive subnormal demands buy one exact tiny pack', () => {
  const basket = tinyBasket([5e-324, 5e-324])
  assert.equal(basket.matchedLineCount, 1)
  assert.equal(basket.unresolvedLineCount, 0)
  assert.equal(basket.lines[0].requirement.amount, 1e-323)
  assert.equal(basket.lines[0].packs, 1)
  assert.equal(basket.lines[0].lineTotalCents, 249)
  assert.equal(basket.totalCents, 249)
})

test('independent: three minimum subnormal demands genuinely require two tiny packs', () => {
  const basket = tinyBasket([5e-324, 5e-324, 5e-324])
  assert.equal(basket.matchedLineCount, 1)
  assert.equal(basket.lines[0].requirement.amount, 1.5e-323)
  assert.equal(basket.lines[0].packs, 2)
  assert.equal(basket.lines[0].lineTotalCents, 498)
  assert.equal(basket.totalCents, 498)
})

test('independent: larger subnormal addition works in either recipe order', () => {
  assert.equal(sumDecimalAmounts([1e-309, 2e-309]), 3e-309)
  assert.equal(sumDecimalAmounts([2e-309, 1e-309]), 3e-309)
  assert.equal(calculateDecimalPackCount(
    [{ amount: 1e-309, unit: 'g' }, { amount: 2e-309, unit: 'g' }],
    { amount: 3e-309, unit: 'g' },
  ), 1)
})

test('independent: same-unit and mixed-unit exact decimals do not disagree for compatible demands', () => {
  assert.equal(sumDecimalAmounts([0.1, 0.2]), 0.3)
  assert.equal(sumDecimalDemandUnits([
    { amount: 5e-324, unit: 'g' },
    { amount: 5e-324, unit: 'g' },
  ], 'g'), 1e-323)
})

test('independent: nonrepresentable mixtures and overflows remain unresolved without rounding', () => {
  assert.equal(sumDecimalAmounts([1e-323, 0.1]), null)
  assert.equal(sumDecimalAmounts([Number.MAX_VALUE, Number.MAX_VALUE]), null)
  assert.equal(sumDecimalAmounts([5e-324, Number.NaN]), null)
  assert.equal(sumDecimalAmounts([]), null)
})
