import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Recipes,
} from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts,
  m3BaselineStore,
  m3CandidateProducts,
  m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'
import {
  restoreShoppingListProgress,
  serializeShoppingListProgress,
  shoppingListBasketKey,
} from '../src/features/shopping-list/shoppingListProgress.ts'

// Controlled demo fixtures only: not actual supermarket prices, field
// observations or a public savings-eligibility result.
function actualBasket({
  plan = m2InitialPlan,
  activeDays = m2DefaultActiveDays,
  store = m3BaselineStore,
  products = m3BaselineProducts,
} = {}) {
  return buildOneStoreBasket({
    plan,
    activeDays,
    store,
    products,
    recipes: m2Recipes,
  })
}

function* permutations(items, prefix = []) {
  if (items.length === 0) {
    yield prefix
    return
  }
  for (let index = 0; index < items.length; index++) {
    yield* permutations(
      [...items.slice(0, index), ...items.slice(index + 1)],
      [...prefix, items[index]],
    )
  }
}

test('product M3: moving the same meals between weekdays preserves stored checked shopping lines', () => {
  const initial = actualBasket()
  const checked = initial.lines.filter((line) => line.status === 'matched')
    .slice(0, 3).map((line) => line.id)
  assert.equal(checked.length, 3)
  const stored = serializeShoppingListProgress(initial, checked)
  const recipes = m2InitialPlan.map((meal) => meal.recipeId)
  const days = m2InitialPlan.map((meal) => meal.day)

  let checkedAssignments = 0
  for (const arranged of permutations(recipes)) {
    const plan = days.map((day, index) => ({ day, recipeId: arranged[index] }))
    const basket = actualBasket({ plan })
    assert.equal(shoppingListBasketKey(basket), shoppingListBasketKey(initial))
    assert.deepEqual(restoreShoppingListProgress(basket, stored), checked)
    checkedAssignments += 1
  }
  assert.equal(checkedAssignments, 24)
})

test('product M3: reordering week rows and picker days does not clear a previously checked basket', () => {
  const original = actualBasket()
  const allIds = original.lines.map((line) => line.id)
  const serialized = serializeShoppingListProgress(original, allIds)

  let cases = 0
  for (const ordered of permutations(m2InitialPlan)) {
    const reordered = actualBasket({
      plan: ordered,
      activeDays: ordered.map((meal) => meal.day).reverse(),
    })
    assert.equal(shoppingListBasketKey(reordered), shoppingListBasketKey(original))
    assert.deepEqual(restoreShoppingListProgress(reordered, serialized), allIds)
    cases += 1
  }
  assert.equal(cases, 24)
})

test('product M3: inactive-day edits retain shopping ticks until the changed recipe becomes active', () => {
  const days = ['Ma', 'Wo']
  const original = actualBasket({ activeDays: days })
  const done = original.lines.slice(0, 2).map((line) => line.id)
  assert.equal(done.length, 2)
  const serialized = serializeShoppingListProgress(original, done)

  const edited = m2InitialPlan.map((meal) =>
    meal.day === 'Do' ? { ...meal, recipeId: 'pasta' } : meal,
  )
  const stillInactive = actualBasket({ plan: edited, activeDays: days })
  assert.deepEqual(restoreShoppingListProgress(stillInactive, serialized), done)
  assert.equal(shoppingListBasketKey(stillInactive), shoppingListBasketKey(original))

  const newlyActive = actualBasket({ plan: edited, activeDays: [...days, 'Do'] })
  assert.notEqual(shoppingListBasketKey(newlyActive), shoppingListBasketKey(original))
  assert.deepEqual(restoreShoppingListProgress(newlyActive, serialized), [])
})

test('product M3: switching the selected retailer never reuses the other store shopping ticks', () => {
  const original = actualBasket()
  const checked = original.lines.slice(0, 3).map((line) => line.id)
  const serialized = serializeShoppingListProgress(original, checked)
  const swapped = actualBasket({
    store: m3CandidateStore,
    products: m3CandidateProducts,
  })
  assert.notEqual(shoppingListBasketKey(swapped), shoppingListBasketKey(original))
  assert.deepEqual(restoreShoppingListProgress(swapped, serialized), [])
  assert.deepEqual(
    restoreShoppingListProgress(original, serializeShoppingListProgress(swapped, checked)),
    [],
  )
})
