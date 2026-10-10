import assert from 'node:assert/strict'
import test from 'node:test'

import { buildIngredientReuseInsight } from '../src/domain/ingredientReuse.ts'
import { previewRecipeReuseChange } from '../src/domain/ingredientReusePreview.ts'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'

const days = m2InitialPlan.map((meal) => meal.day)
const recipeIds = m2Recipes.map((recipe) => recipe.id)

function* allPlans(index = 0, selected = []) {
  if (index === days.length) {
    yield selected
    return
  }
  for (const recipeId of recipeIds) {
    yield* allPlans(index + 1, [...selected, { day: days[index], recipeId }])
  }
}

function byId(insight) {
  return new Map(insight.reusedIngredients.map((row) => [row.ingredientId, row]))
}

function sorted(ids) {
  return [...ids].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
}

test('7,776 preview proposals classify every shared-ingredient transition against current and proposed plan', () => {
  let proposals = 0
  let changed = 0
  let noOp = 0
  let created = 0
  let lost = 0

  for (const plan of allPlans()) {
    for (let mask = 1; mask < (1 << days.length); mask++) {
      const activeDays = days.filter((_, index) => (mask & (1 << index)) !== 0)
      const beforeInsight = buildIngredientReuseInsight({ plan, activeDays, recipes: m2Recipes })
      assert.ok(beforeInsight, 'canonical active plan must be valid')
      const before = byId(beforeInsight)

      for (const day of activeDays) {
        for (const recipeId of recipeIds) {
          const input = { plan, activeDays, recipes: m2Recipes, day, recipeId }
          const beforeJson = JSON.stringify(input)
          const preview = previewRecipeReuseChange(input)
          assert.ok(preview, `day ${day} recipe ${recipeId}`)
          assert.equal(JSON.stringify(input), beforeJson, 'preview must not apply or persist a recipe')

          const proposed = plan.map((meal) =>
            meal.day === day ? { ...meal, recipeId } : meal,
          )
          const nextInsight = buildIngredientReuseInsight({
            plan: proposed, activeDays, recipes: m2Recipes,
          })
          assert.ok(nextInsight)
          const after = byId(nextInsight)

          const newlyShared = sorted([...after.keys()].filter((id) => !before.has(id)))
          const noLongerShared = sorted([...before.keys()].filter((id) => !after.has(id)))
          const changedShared = sorted([...before.keys()].filter((id) =>
            after.has(id) && (
              before.get(id).mealCount !== after.get(id).mealCount ||
              JSON.stringify(before.get(id).days) !== JSON.stringify(after.get(id).days)
            ),
          ))

          assert.equal(preview.day, day)
          assert.equal(preview.previousRecipeId, plan.find((meal) => meal.day === day).recipeId)
          assert.equal(preview.nextRecipeId, recipeId)
          assert.equal(preview.beforeSharedCount, before.size)
          assert.equal(preview.afterSharedCount, after.size)
          assert.deepEqual(preview.newlyShared.map((row) => row.ingredientId), newlyShared)
          assert.deepEqual(preview.noLongerShared.map((row) => row.ingredientId), noLongerShared)
          assert.deepEqual(preview.changedShared.map((row) => row.ingredientId), changedShared)

          for (const row of [...preview.newlyShared, ...preview.noLongerShared, ...preview.changedShared]) {
            const old = before.get(row.ingredientId)
            const next = after.get(row.ingredientId)
            assert.equal(row.beforeSharedMealCount, old?.mealCount ?? null)
            assert.equal(row.afterSharedMealCount, next?.mealCount ?? null)
            assert.deepEqual(row.beforeDays, old?.days ?? [])
            assert.deepEqual(row.afterDays, next?.days ?? [])
            assert.equal(row.label, next?.label ?? old.label)
            assert.equal(Object.hasOwn(row, 'priceCents'), false)
            assert.equal(Object.hasOwn(row, 'savingsCents'), false)
            assert.equal(Object.hasOwn(row, 'packCount'), false)
          }

          if (preview.previousRecipeId === recipeId) {
            noOp++
            assert.deepEqual(preview.newlyShared, [])
            assert.deepEqual(preview.noLongerShared, [])
            assert.deepEqual(preview.changedShared, [])
          }
          if (changedShared.length) changed++
          if (newlyShared.length) created++
          if (noLongerShared.length) lost++
          proposals++
        }
      }
    }
  }

  assert.equal(proposals, 81 * 96)
  assert.equal(noOp, proposals / 3)
  assert.ok(changed > 0 && created > 0 && lost > 0)
})

test('inactive recipe mutations cannot create fake new/shared observations', () => {
  for (const plan of allPlans()) {
    const activeDays = ['Ma']
    const unchanged = buildIngredientReuseInsight({ plan, recipes: m2Recipes, activeDays })
    assert.ok(unchanged)

    for (const inactiveDay of ['Di', 'Wo', 'Do']) {
      const next = plan.map((meal) =>
        meal.day === inactiveDay
          ? { ...meal, recipeId: recipeIds.find((id) => id !== meal.recipeId) }
          : meal,
      )
      assert.deepEqual(
        buildIngredientReuseInsight({ plan: next, recipes: m2Recipes, activeDays }),
        unchanged,
      )
      assert.equal(
        previewRecipeReuseChange({
          plan, activeDays, recipes: m2Recipes, day: inactiveDay, recipeId: 'pasta',
        }),
        null,
      )
    }
  }
})
