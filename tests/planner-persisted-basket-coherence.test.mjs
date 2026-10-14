import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  parsePlannerPreferences,
  serializePlannerPreferences,
} from '../src/domain/plannerPreferences.ts'
import {
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

const recipeIds = m2Recipes.map((recipe) => recipe.id)
const days = m2InitialPlan.map((meal) => meal.day)
const budgets = [30, 35, 40]

function planFor(recipeByDay) {
  return m2InitialPlan.map((meal) => ({
    day: meal.day,
    recipeId: recipeByDay[meal.day],
  }))
}

function basketFor(recipeByDay, activeDays) {
  return buildOneStoreBasket({
    store: m2Store,
    plan: planFor(recipeByDay),
    recipes: m2Recipes,
    activeDays,
    products: m2Products,
  })
}

test('every controlled M2 week survives a saved-preferences reload without changing basket demand', () => {
  let checked = 0

  // 3^4 recipe assignments x 2^4 active-day choices: 1,296 distinct weeks.
  for (let assignment = 0; assignment < 3 ** days.length; assignment += 1) {
    const recipeByDay = Object.fromEntries(
      days.map((day, position) => [
        day,
        recipeIds[Math.floor(assignment / (3 ** position)) % recipeIds.length],
      ]),
    )

    for (let mask = 0; mask < 2 ** days.length; mask += 1) {
      const activeDays = days.filter((_, position) => mask & (1 << position))
      const budget = budgets[(assignment + mask) % budgets.length]
      const saved = {
        budget,
        // Storage can contain arbitrary ordering, while UI restores canonical order.
        activeDays: [...activeDays].reverse(),
        recipeByDay,
      }

      const restored = parsePlannerPreferences(
        serializePlannerPreferences(saved),
        m2InitialPlan,
        recipeIds,
      )

      assert.deepEqual(restored, {
        budget,
        activeDays,
        recipeByDay,
      }, `restored preferences assignment=${assignment}, mask=${mask}`)

      const before = basketFor(recipeByDay, activeDays)
      const after = basketFor(restored.recipeByDay, restored.activeDays)
      assert.deepEqual(after, before, `basket assignment=${assignment}, mask=${mask}`)
      assert.equal(after.selectedMealCount, activeDays.length)
      assert.equal(after.matchedLineCount + after.unresolvedLineCount, after.lines.length)
      assert.equal(
        after.totalCents,
        after.lines.reduce(
          (sum, line) => sum + (line.status === 'matched' ? line.lineTotalCents : 0),
          0,
        ),
      )
      checked += 1
    }
  }

  assert.equal(checked, 1_296)
})

test('changing an inactive recipe does not silently add demand on reload', () => {
  const original = {
    budget: 35,
    activeDays: ['Ma'],
    recipeByDay: { Ma: 'tikka', Di: 'teriyaki', Wo: 'pasta', Do: 'tikka' },
  }
  const editedInactive = {
    ...original,
    recipeByDay: { ...original.recipeByDay, Di: 'pasta', Wo: 'tikka', Do: 'teriyaki' },
  }

  const restoredOriginal = parsePlannerPreferences(
    serializePlannerPreferences(original),
    m2InitialPlan,
    recipeIds,
  )
  const restoredEdited = parsePlannerPreferences(
    serializePlannerPreferences(editedInactive),
    m2InitialPlan,
    recipeIds,
  )

  assert.deepEqual(
    basketFor(restoredOriginal.recipeByDay, restoredOriginal.activeDays),
    basketFor(restoredEdited.recipeByDay, restoredEdited.activeDays),
  )
  assert.notDeepEqual(restoredOriginal.recipeByDay, restoredEdited.recipeByDay)
})

test('stale saved day and recipe cannot enter the restored active basket', () => {
  const restored = parsePlannerPreferences(
    JSON.stringify({
      budget: 40,
      activeDays: ['Wo', 'Ma', 'Wo', 'Za'],
      recipeByDay: {
        Ma: 'teriyaki',
        Di: 'retired-recipe',
        Wo: 'pasta',
        Do: 'tikka',
        Za: 'retired-recipe',
      },
    }),
    m2InitialPlan,
    recipeIds,
  )

  assert.deepEqual(restored.activeDays, ['Ma', 'Wo'])
  assert.equal(restored.recipeByDay.Ma, 'teriyaki')
  assert.equal(restored.recipeByDay.Di, 'teriyaki')
  assert.equal(Object.hasOwn(restored.recipeByDay, 'Za'), false)

  const basket = basketFor(restored.recipeByDay, restored.activeDays)
  assert.equal(basket.selectedMealCount, 2)
  assert.equal(basket.lines.some((line) => line.id === 'chicken-thigh'), false)
  assert.equal(
    basket.totalCents,
    basket.lines.reduce(
      (sum, line) => sum + (line.status === 'matched' ? line.lineTotalCents : 0),
      0,
    ),
  )
})

test('the frozen canonical recipe and product fixtures remain untouched by persistence and basket calculation', () => {
  const frozenRecipes = JSON.stringify(m2Recipes)
  const frozenProducts = JSON.stringify(m2Products)
  const frozenPlan = JSON.stringify(m2InitialPlan)
  const preferences = {
    budget: 30,
    activeDays: ['Do', 'Ma'],
    recipeByDay: { Ma: 'pasta', Di: 'tikka', Wo: 'teriyaki', Do: 'teriyaki' },
  }

  const restored = parsePlannerPreferences(
    serializePlannerPreferences(preferences),
    m2InitialPlan,
    recipeIds,
  )
  const first = basketFor(restored.recipeByDay, restored.activeDays)
  const second = basketFor(restored.recipeByDay, restored.activeDays)

  assert.deepEqual(first, second)
  assert.equal(JSON.stringify(m2Recipes), frozenRecipes)
  assert.equal(JSON.stringify(m2Products), frozenProducts)
  assert.equal(JSON.stringify(m2InitialPlan), frozenPlan)
})
