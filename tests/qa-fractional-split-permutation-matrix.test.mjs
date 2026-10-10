import assert from 'node:assert/strict'
import test from 'node:test'

import { aggregatePlanIngredients, buildOneStoreBasket } from '../src/domain/basket.ts'

// Deterministic split/permutation matrix for the existing fractional-pack bug.
// These are invented QA quantities and prices, NOT observed retailer evidence.
const store = Object.freeze({ id: 'qa-decimal-matrix', name: 'Testwinkel' })
const days = Object.freeze(['Ma', 'Di', 'Wo'])

function basketFor(amounts, { unit = 'g', packAmount = 0.3, packUnit = unit, priceCents = 199 } = {}) {
  const activeDays = days.slice(0, amounts.length)
  const recipes = amounts.map((amount, index) => ({
    id: `recipe-${index}`,
    title: 'Testmaaltijd',
    minutes: 10,
    servings: 1,
    estimatedCost: 1.99,
    tags: [],
    ingredients: [{
      id: 'shared',
      label: 'Testingrediënt',
      query: 'testingredient',
      amount,
      unit,
    }],
  }))
  const plan = amounts.map((_, index) => ({
    day: activeDays[index],
    recipeId: `recipe-${index}`,
  }))
  const products = [{
    id: 'exact-pack',
    storeId: store.id,
    name: 'testingredient',
    packAmount,
    packUnit,
    priceCents,
    available: true,
  }]

  // Catch accidental writes to caller-owned planner and catalog records.
  for (const recipe of recipes) {
    Object.freeze(recipe.ingredients[0])
    Object.freeze(recipe.ingredients)
    Object.freeze(recipe)
  }
  for (const row of plan) Object.freeze(row)
  for (const product of products) Object.freeze(product)
  Object.freeze(recipes)
  Object.freeze(plan)
  Object.freeze(products)

  const aggregate = aggregatePlanIngredients(plan, recipes, activeDays)
  const basket = buildOneStoreBasket({ store, plan, recipes, activeDays, products })
  return { aggregate, basket }
}

function assertTrustedPacks(result, expectedPacks, priceCents = 199) {
  assert.equal(result.aggregate.length, 1)
  assert.equal(result.basket.matchedLineCount, 1)
  assert.equal(result.basket.unresolvedLineCount, 0)
  assert.equal(result.basket.lines.length, 1)
  assert.equal(result.basket.lines[0].status, 'matched')
  assert.equal(result.basket.lines[0].packs, expectedPacks)
  assert.equal(result.basket.lines[0].lineTotalCents, expectedPacks * priceCents)
  assert.equal(result.basket.totalCents, expectedPacks * priceCents)
}

test('fractional quality matrix: every 0.30g two-meal decimal split fits one 0.30g pack in either order', () => {
  for (let cents = 1; cents < 30; cents++) {
    const first = cents / 100
    const second = (30 - cents) / 100
    for (const portions of [[first, second], [second, first]]) {
      const result = basketFor(portions)
      assert.equal(result.aggregate[0].amount, 0.3, `split ${portions.join(' + ')}`)
      assertTrustedPacks(result, 1)
      assert.equal(result.basket.selectedMealCount, 2)
    }
  }
})

test('fractional quality matrix: real over-the-boundary demand never gets hidden by tolerance', () => {
  for (const cents of [1, 3, 7, 11, 13, 17, 23, 29]) {
    const result = basketFor([cents / 100, (30 - cents) / 100 + 0.0001])
    assert.equal(result.aggregate[0].amount, 0.3001)
    assertTrustedPacks(result, 2)
  }
})

test('fractional quality matrix: three meals maintain whole-pack and money parity', () => {
  for (const amounts of [[0.1, 0.1, 0.1], [0.07, 0.11, 0.12], [0.01, 0.17, 0.12]]) {
    const result = basketFor(amounts, { priceCents: 0 })
    assert.equal(result.aggregate[0].amount, 0.3)
    assertTrustedPacks(result, 1, 0)
    assert.equal(result.basket.selectedMealCount, 3)
    const above = basketFor([amounts[0], amounts[1], amounts[2] + 0.0001])
    assert.equal(above.aggregate[0].amount, 0.3001)
    assertTrustedPacks(above, 2)
  }
})

test('fractional quality matrix: sub-gram mass and sub-millilitre volume conversion remain exact', () => {
  const cases = [
    { unit: 'kg', amounts: [0.00001, 0.00002], packAmount: 0.03, packUnit: 'g' },
    { unit: 'l', amounts: [0.00001, 0.00002], packAmount: 0.03, packUnit: 'ml' },
    { unit: 'ml', amounts: [0.01, 0.02], packAmount: 0.00003, packUnit: 'l' },
    { unit: 'g', amounts: [0.01, 0.02], packAmount: 0.00003, packUnit: 'kg' },
  ]
  for (const { amounts, ...pack } of cases) {
    const result = basketFor(amounts, pack)
    assertTrustedPacks(result, 1)
    const above = basketFor([amounts[0], amounts[1] + amounts[0] / 100], pack)
    assertTrustedPacks(above, 2)
  }
})
