import assert from 'node:assert/strict'
import test from 'node:test'

import { aggregatePlanIngredients, buildOneStoreBasket } from '../src/domain/basket.ts'

// Exact decimal ingredient demand from two active meals must not invent a
// second physical pack. All inputs/prices are synthetic, not live evidence.
const store = Object.freeze({ id: 'qa-fractional-pack', name: 'Testwinkel' })

function twoMeals(amountA, amountB, unit, packAmount, packUnit) {
  const makeRecipe = (id, amount) => ({
    id, title: 'Testrecept', minutes: 10, servings: 1,
    estimatedCost: 1.99, tags: [],
    ingredients: [{
      id: 'shared-ingredient', label: 'Testingrediënt',
      query: 'testingredient', amount, unit,
    }],
  })
  const recipes = [makeRecipe('first', amountA), makeRecipe('second', amountB)]
  const plan = [
    { day: 'Ma', recipeId: 'first' },
    { day: 'Di', recipeId: 'second' },
  ]
  const product = {
    id: 'sized-pack', name: 'testingredient', storeId: store.id,
    available: true, packAmount, packUnit, priceCents: 199,
  }
  return {
    ingredients: aggregatePlanIngredients(plan, recipes, ['Ma', 'Di']),
    basket: buildOneStoreBasket({
      store, plan, recipes, activeDays: ['Ma', 'Di'], products: [product],
    }),
    recipes,
    plan,
    product,
  }
}

function expectPacks(value, packs, label) {
  assert.equal(value.basket.selectedMealCount, 2, label)
  assert.equal(value.basket.matchedLineCount, 1, label)
  assert.equal(value.basket.unresolvedLineCount, 0, label)
  const [line] = value.basket.lines
  assert.equal(line.status, 'matched', label)
  assert.equal(line.packs, packs, label)
  assert.equal(line.lineTotalCents, packs * 199, label)
  assert.equal(value.basket.totalCents, packs * 199, label)
  assert.equal(line.pricePerPackCents, 199, label)
}

test('control: one exact decimal-pack demand uses one physical unit', () => {
  const value = twoMeals(0.15, 0.15, 'g', 0.3, 'g')
  expectPacks(value, 1, 'single 0.3 g pack')
  assert.equal(value.ingredients[0].amount, 0.3)
})

test('negative: 0.1 + 0.2 g aggregation must not invent a second 0.3 g package', () => {
  const value = twoMeals(0.1, 0.2, 'g', 0.3, 'g')
  assert.equal(value.ingredients.length, 1)
  assert.equal(value.ingredients[0].amount, 0.3,
    'decimal aggregation must preserve mathematically exact package boundary')
  expectPacks(value, 1, '0.1 + 0.2 g is exactly 0.3 g')
})

test('negative: decimal reuse must remain exact when physical quantities convert units', async (t) => {
  const cases = [
    ['0.1 + 0.2 ml / 0.3 ml pack', 0.1, 0.2, 'ml', 0.3, 'ml', 0.3],
    ['0.0001 + 0.0002 kg / 0.3 g pack', 0.0001, 0.0002, 'kg', 0.3, 'g', 0.0003],
    ['0.0001 + 0.0002 l / 0.3 ml pack', 0.0001, 0.0002, 'l', 0.3, 'ml', 0.0003],
  ]
  for (const [label, a, b, unit, packAmount, packUnit, total] of cases) {
    await t.test(label, () => {
      const value = twoMeals(a, b, unit, packAmount, packUnit)
      assert.equal(value.ingredients[0].amount, total, label)
      expectPacks(value, 1, label)
    })
  }
})

test('control: true decimal overbuy still needs a second pack (never blanket-epsilon)', async (t) => {
  const cases = [
    [0.1, 0.2001, 0.3, 2],
    [0.15, 0.15, 0.2999, 2],
    [0.15, 0.15, 0.3, 1],
  ]
  for (const [a, b, pack, expected] of cases) {
    await t.test(`${a} + ${b} / ${pack}`, () => {
      expectPacks(twoMeals(a, b, 'g', pack, 'g'), expected, 'real boundary')
    })
  }
})

test('fractional basket calculation never mutates plan, recipes or product catalog', () => {
  const { basket, plan, recipes, product } = twoMeals(0.1, 0.2, 'g', 0.3, 'g')
  assert.equal(plan[0].day, 'Ma')
  assert.equal(plan[1].day, 'Di')
  assert.equal(recipes[0].ingredients[0].amount, 0.1)
  assert.equal(recipes[1].ingredients[0].amount, 0.2)
  assert.equal(product.priceCents, 199)
  assert.equal(basket.store.id, store.id)
})
