import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregatePlanIngredients, buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'

const activeDay = m2InitialPlan[0].day
const activeMeal = m2InitialPlan[0]
const inactive = { day: '__inactive_day__', recipeId: '__missing_recipe__' }

function basket(plan, activeDays = [activeDay]) {
  return buildOneStoreBasket({
    store: m2Store,
    plan,
    recipes: m2Recipes,
    activeDays,
    products: m2Products,
  })
}

test('a missing recipe on an inactive day does not change the active basket', () => {
  const expected = basket([activeMeal])
  assert.deepEqual(basket([activeMeal, inactive]), expected)
  assert.equal(expected.selectedMealCount, 1)
})

test('duplicate inactive entries cannot contaminate active requirements', () => {
  const expected = aggregatePlanIngredients([activeMeal], m2Recipes, [activeDay])
  assert.deepEqual(
    aggregatePlanIngredients([inactive, activeMeal, inactive], m2Recipes, [activeDay]),
    expected,
  )
  assert.deepEqual(basket([inactive, activeMeal, inactive]), basket([activeMeal]))
})

test('missing active-day demand remains a hard error even with inactive meals', () => {
  assert.throws(
    () => basket([inactive]),
    /Missing planned meal for active day/,
  )
})

test('empty active days yield no demand even if inactive recipes are missing', () => {
  const result = basket([inactive], [])
  assert.equal(result.selectedMealCount, 0)
  assert.deepEqual(result.lines, [])
  assert.equal(result.totalCents, 0)
  assert.equal(result.matchedLineCount, 0)
  assert.equal(result.unresolvedLineCount, 0)
})
