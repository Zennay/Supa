import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { parsePlannerPreferencesWithCustomBudget } from '../src/domain/customPlannerBudget.ts'
import { serializePlannerPreferences } from '../src/domain/plannerPreferences.ts'
import {
  restoreShoppingListProgress,
  serializeShoppingListProgress,
  shoppingListBasketKey,
} from '../src/features/shopping-list/shoppingListProgress.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import {
  m3CandidateProducts,
  m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

// Product #1424: budget-first planner edits must preserve checked items only
// if the actual basket is unchanged. All inputs are local, synthetic fixtures.
// This tests current v1 behavior; v2 price-stable upgrade is separate #1056.
const recipeIds = m2Recipes.map((recipe) => recipe.id)
const recipeByDay = Object.fromEntries(m2InitialPlan.map(({ day, recipeId }) => [day, recipeId]))

function preferences(budget, activeDays = ['Wo'], recipes = recipeByDay) {
  return parsePlannerPreferencesWithCustomBudget(
    serializePlannerPreferences({ budget, activeDays, recipeByDay: recipes }),
    m2InitialPlan, recipeIds,
  )
}

function basket(user, store = m2Store, products = m2Products) {
  const plan = m2InitialPlan.map((meal) => ({
    day: meal.day, recipeId: user.recipeByDay[meal.day],
  }))
  return buildOneStoreBasket({
    store, products, plan, activeDays: user.activeDays, recipes: m2Recipes,
  })
}

test('product #1424: switching custom and chip budgets preserves current checked groceries', () => {
  const current = basket(preferences(27.5))
  assert.equal(current.unresolvedLineCount, 0)
  const id = current.lines[0].id
  const saved = serializeShoppingListProgress(current, [id])
  const pinnedKey = shoppingListBasketKey(current)
  const original = JSON.stringify(current)

  for (const value of [42.75, 30, 0.01, 35, 1000, 27.5]) {
    const user = preferences(value)
    const rebuilt = basket(user)
    assert.deepEqual(rebuilt, current, `shopping requirements drifted for budget ${value}`)
    assert.equal(shoppingListBasketKey(rebuilt), pinnedKey)
    assert.deepEqual(restoreShoppingListProgress(rebuilt, saved), [id])
  }
  assert.equal(JSON.stringify(current), original)
})

test('product #1424: budget persistence never carries completed ticks across new meal demand', () => {
  const initial = basket(preferences(27.5, ['Wo']))
  assert.equal(initial.unresolvedLineCount, 0)
  const done = initial.lines.map((line) => line.id)
  const saved = serializeShoppingListProgress(initial, done)
  assert.deepEqual(restoreShoppingListProgress(initial, saved), done)

  const expanded = basket(preferences(27.5, ['Di', 'Wo']))
  assert.equal(expanded.selectedMealCount, 2)
  assert.notEqual(shoppingListBasketKey(expanded), shoppingListBasketKey(initial))
  assert.deepEqual(restoreShoppingListProgress(expanded, saved), [])

  const swapped = basket(preferences(27.5, ['Wo'], { ...recipeByDay, Wo: 'teriyaki' }))
  assert.equal(swapped.selectedMealCount, 1)
  assert.notEqual(shoppingListBasketKey(swapped), shoppingListBasketKey(initial))
  assert.deepEqual(restoreShoppingListProgress(swapped, saved), [])
})

test('product #1424: budget does not bypass the store-identity boundary for checked products', () => {
  const user = preferences(27.5, ['Wo'])
  const original = basket(user)
  const checkedId = original.lines[0].id
  const checked = serializeShoppingListProgress(original, [checkedId])

  const anotherStore = basket(user, m3CandidateStore, m3CandidateProducts)
  assert.equal(anotherStore.selectedMealCount, original.selectedMealCount)
  assert.notEqual(anotherStore.store.id, original.store.id)
  assert.notEqual(shoppingListBasketKey(anotherStore), shoppingListBasketKey(original))
  assert.deepEqual(restoreShoppingListProgress(anotherStore, checked), [])
  assert.deepEqual(restoreShoppingListProgress(original, checked), [checkedId])
})
