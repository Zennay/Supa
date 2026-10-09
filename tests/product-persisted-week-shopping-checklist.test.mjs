import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  parsePlannerPreferences,
  serializePlannerPreferences,
} from '../src/domain/plannerPreferences.ts'
import {
  restoreShoppingListProgress,
  serializeShoppingListProgress,
  shoppingListBasketKey,
} from '../src/features/shopping-list/shoppingListProgress.ts'
import {
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

const recipeIds = m2Recipes.map((recipe) => recipe.id)

function fromSavedPreferences(preferences) {
  const restored = parsePlannerPreferences(
    serializePlannerPreferences(preferences),
    m2InitialPlan,
    recipeIds,
  )
  return buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan.map((meal) => ({
      day: meal.day,
      recipeId: restored.recipeByDay[meal.day],
    })),
    recipes: m2Recipes,
    activeDays: restored.activeDays,
    products: m2Products,
  })
}

const defaultWeek = {
  budget: 35,
  activeDays: ['Ma', 'Di', 'Wo', 'Do'],
  recipeByDay: { Ma: 'tikka', Di: 'teriyaki', Wo: 'pasta', Do: 'tikka' },
}

test('saved checked items reset when selected meals change the actual basket', () => {
  const before = fromSavedPreferences(defaultWeek)
  assert.ok(before.lines.length > 2)
  const completed = [before.lines[0].id, before.lines[1].id]
  const storedProgress = serializeShoppingListProgress(before, completed)
  assert.deepEqual(restoreShoppingListProgress(before, storedProgress), completed)

  const after = fromSavedPreferences({
    ...defaultWeek,
    activeDays: ['Wo'],
  })

  assert.notEqual(shoppingListBasketKey(before), shoppingListBasketKey(after))
  assert.deepEqual(restoreShoppingListProgress(after, storedProgress), [])
  assert.equal(after.selectedMealCount, 1)
})

test('an inactive recipe change preserves checklist progress if the actual basket is unchanged', () => {
  const before = fromSavedPreferences({
    ...defaultWeek,
    activeDays: ['Ma'],
  })
  const done = before.lines.slice(0, 2).map((line) => line.id)
  const storedProgress = serializeShoppingListProgress(before, done)

  const after = fromSavedPreferences({
    ...defaultWeek,
    activeDays: ['Ma'],
    recipeByDay: {
      ...defaultWeek.recipeByDay,
      Di: 'pasta',
      Wo: 'teriyaki',
      Do: 'pasta',
    },
  })

  assert.deepEqual(before, after)
  assert.equal(shoppingListBasketKey(before), shoppingListBasketKey(after))
  assert.deepEqual(restoreShoppingListProgress(after, storedProgress), done)
})

test('a newly empty week never resurrects checked items from the previous basket', () => {
  const before = fromSavedPreferences(defaultWeek)
  const storedProgress = serializeShoppingListProgress(
    before,
    before.lines.map((line) => line.id),
  )

  const after = fromSavedPreferences({
    ...defaultWeek,
    activeDays: [],
  })

  assert.equal(after.selectedMealCount, 0)
  assert.equal(after.lines.length, 0)
  assert.equal(after.totalCents, 0)
  assert.deepEqual(restoreShoppingListProgress(after, storedProgress), [])
})

test('checklist status survives a clean planner reload with identical selected demand', () => {
  const original = fromSavedPreferences(defaultWeek)
  const checkedIds = original.lines
    .filter((line) => line.status === 'matched')
    .slice(0, 3)
    .map((line) => line.id)
  assert.equal(checkedIds.length, 3)

  const saved = serializeShoppingListProgress(original, checkedIds)
  const reloaded = fromSavedPreferences({
    ...defaultWeek,
    activeDays: ['Do', 'Wo', 'Di', 'Ma'],
  })

  assert.deepEqual(restoreShoppingListProgress(reloaded, saved), checkedIds)
  assert.deepEqual(reloaded, original)
})
