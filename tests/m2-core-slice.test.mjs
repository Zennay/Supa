import assert from 'node:assert/strict'
import test from 'node:test'

import {
  aggregatePlanIngredients,
  buildOneStoreBasket,
} from '../src/domain/basket.ts'
import { getBudgetState } from '../src/domain/planner.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

test('M2 default plan produces a reproducible one-store basket with visible uncertainty', () => {
  const basket = buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: m2Products,
  })

  assert.equal(basket.selectedMealCount, 4)
  assert.equal(basket.totalCents, 3008)
  assert.equal(basket.matchedLineCount, 10)
  assert.equal(basket.unresolvedLineCount, 1)

  const budgetState = getBudgetState(basket.totalCents / 100, 35)
  assert.equal(budgetState.plannedCost, 30.08)
  assert.ok(Math.abs(budgetState.remaining - 4.92) < 1e-9)
  assert.equal(budgetState.overBudget, false)

  const unresolved = basket.lines.find((line) => line.id === 'garam-masala')
  assert.ok(unresolved)
  assert.equal(unresolved.status, 'unresolved')
  assert.match(unresolved.reasons.join(' '), /score below trust threshold/)
})

test('repeated recipe ingredients aggregate before pack calculation', () => {
  const ingredients = aggregatePlanIngredients(
    m2InitialPlan,
    m2Recipes,
    m2DefaultActiveDays,
  )

  assert.deepEqual(
    ingredients.find((ingredient) => ingredient.id === 'chicken-thigh'),
    {
      id: 'chicken-thigh',
      label: 'Kippendij',
      query: 'kippendij',
      amount: 600,
      unit: 'g',
    },
  )

  const basket = buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: m2Products,
  })
  const chicken = basket.lines.find((line) => line.id === 'chicken-thigh')
  assert.ok(chicken)
  assert.equal(chicken.status, 'matched')
  assert.equal(chicken.packs, 2)
  assert.equal(chicken.lineTotalCents, 958)
})

test('turning off one planned day deterministically changes the same basket', () => {
  const basket = buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: ['Ma', 'Di', 'Wo'],
    products: m2Products,
  })

  assert.equal(basket.selectedMealCount, 3)
  assert.equal(basket.totalCents, 2330)
  const chicken = basket.lines.find((line) => line.id === 'chicken-thigh')
  assert.ok(chicken)
  assert.equal(chicken.status, 'matched')
  assert.equal(chicken.packs, 1)
})

test('changing a recipe changes the basket while preserving traceability', () => {
  const changedPlan = m2InitialPlan.map((meal) =>
    meal.day === 'Di' ? { ...meal, recipeId: 'pasta' } : meal,
  )
  const basket = buildOneStoreBasket({
    store: m2Store,
    plan: changedPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: m2Products,
  })

  assert.equal(basket.totalCents, 2330)
  const tomatoes = basket.lines.find((line) => line.id === 'tomato-cubes')
  assert.ok(tomatoes)
  assert.equal(tomatoes.status, 'matched')
  assert.equal(tomatoes.packs, 2)
  assert.equal(tomatoes.lineTotalCents, 198)
})

test('inconsistent ingredient definitions fail instead of silently aggregating', () => {
  const inconsistentRecipes = [
    ...m2Recipes,
    {
      ...m2Recipes[0],
      id: 'bad-copy',
      ingredients: m2Recipes[0].ingredients.map((ingredient) =>
        ingredient.id === 'basmati-rice'
          ? { ...ingredient, unit: 'ml' }
          : ingredient,
      ),
    },
  ]
  const plan = [
    { day: 'Ma', recipeId: 'tikka' },
    { day: 'Di', recipeId: 'bad-copy' },
  ]

  assert.throws(
    () => aggregatePlanIngredients(plan, inconsistentRecipes, ['Ma', 'Di']),
    /Ingredient definition drift/,
  )
})
