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

test('canonical basket uses exact decimal ingredient reuse and pack cents (#1053)', () => {
  const store = { id: 'decimal-store', name: 'Rekenvoorbeeld' }
  const makeInput = (left, right, unit, packAmount, packUnit) => ({
    store,
    activeDays: ['Ma', 'Di'],
    plan: [{ day: 'Ma', recipeId: 'a' }, { day: 'Di', recipeId: 'b' }],
    recipes: [left, right].map((amount, index) => ({
      id: index === 0 ? 'a' : 'b',
      title: 'Testrecept', minutes: 10, servings: 1, estimatedCost: 1,
      tags: [],
      ingredients: [{ id: 'same', label: 'Ingrediënt', query: 'testingredient', unit, amount }],
    })),
    products: [{
      id: 'pack', name: 'testingredient', storeId: store.id,
      available: true, packAmount, packUnit, priceCents: 199,
    }],
  })
  for (const [left, right, unit, packAmount, packUnit, expectedAmount, expectedPacks] of [
    [0.1, 0.2, 'g', 0.3, 'g', 0.3, 1],
    [0.0001, 0.0002, 'kg', 0.3, 'g', 0.0003, 1],
    [0.0001, 0.0002, 'l', 0.3, 'ml', 0.0003, 1],
    [0.1, 0.2001, 'g', 0.3, 'g', 0.3001, 2],
    [0.15, 0.15, 'g', 0.2999, 'g', 0.3, 2],
  ]) {
    const input = makeInput(left, right, unit, packAmount, packUnit)
    const before = structuredClone(input)
    const basket = buildOneStoreBasket(input)
    const line = basket.lines[0]
    assert.equal(line.status, 'matched')
    assert.equal(line.requirement.amount, expectedAmount)
    assert.equal(line.packs, expectedPacks)
    assert.equal(line.lineTotalCents, expectedPacks * 199)
    assert.equal(basket.totalCents, expectedPacks * 199)
    assert.equal(basket.selectedMealCount, 2)
    assert.deepEqual(input, before)
  }
})

test('canonical decimal basket remains fail-closed for unsafe pack arithmetic', () => {
  const store = { id: 'decimal-store', name: 'Rekenvoorbeeld' }
  const plan = [{ day: 'Ma', recipeId: 'a' }]
  const recipes = [{
    id: 'a', title: 'Testrecept', minutes: 10, servings: 1, estimatedCost: 1, tags: [],
    ingredients: [{ id: 'same', label: 'Ingrediënt', query: 'testingredient', amount: 0.3, unit: 'g' }],
  }]
  const results = [
    { packAmount: Number.MIN_VALUE, packUnit: 'g' },
    { packAmount: 0, packUnit: 'g' },
    { packAmount: 1, packUnit: 'l' },
  ]
  for (const modification of results) {
    const basket = buildOneStoreBasket({
      store, plan, recipes, activeDays: ['Ma'], products: [{
        id: 'pack', name: 'testingredient', storeId: store.id, priceCents: 199,
        available: true, ...modification,
      }],
    })
    assert.equal(basket.totalCents, 0)
    assert.equal(basket.matchedLineCount, 0)
    assert.equal(basket.unresolvedLineCount, 1)
  }
})
