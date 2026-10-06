import assert from 'node:assert/strict'
import test from 'node:test'

import {
  aggregatePlanIngredients,
  buildOneStoreBasket,
} from '../src/domain/basket.ts'
import {
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

test('basket aggregation rejects malformed top-level collection inputs deterministically', () => {
  assert.throws(
    () => aggregatePlanIngredients(null, m2Recipes, ['Ma']),
    /Basket plan must be an array/,
  )
  assert.throws(
    () => aggregatePlanIngredients(m2InitialPlan, null, ['Ma']),
    /Basket recipes must be an array/,
  )
  assert.throws(
    () => aggregatePlanIngredients(m2InitialPlan, m2Recipes, null),
    /Basket active days must be an array/,
  )
})

test('basket construction rejects a malformed product collection before filtering', () => {
  assert.throws(
    () =>
      buildOneStoreBasket({
        store: m2Store,
        plan: m2InitialPlan,
        recipes: m2Recipes,
        activeDays: ['Ma'],
        products: null,
      }),
    /Basket products must be an array/,
  )
})

test('basket runtime collection guards preserve an intentionally empty active week', () => {
  const basket = buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: [],
    products: m2Products,
  })

  assert.equal(basket.selectedMealCount, 0)
  assert.equal(basket.totalCents, 0)
  assert.equal(basket.matchedLineCount, 0)
  assert.equal(basket.unresolvedLineCount, 0)
  assert.deepEqual(basket.lines, [])
})
