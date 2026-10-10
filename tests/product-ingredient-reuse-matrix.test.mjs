import assert from 'node:assert/strict'
import test from 'node:test'

import { buildIngredientReuseInsight } from '../src/domain/ingredientReuse.ts'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'

const allDays = m2InitialPlan.map((meal) => meal.day)
const recipeIds = m2Recipes.map((recipe) => recipe.id)
const byId = new Map(m2Recipes.map((recipe) => [recipe.id, recipe]))

test('all 1,215 active-day / recipe-choice combinations keep exact qualitative reuse', () => {
  let combinations = 0
  for (let pattern = 1; pattern < (1 << allDays.length); pattern++) {
    const activeDays = allDays.filter((_, index) => (pattern & (1 << index)) !== 0)
    for (let selection = 0; selection < 3 ** allDays.length; selection++) {
      let chosen = selection
      const plan = allDays.map((day) => {
        const recipeId = recipeIds[chosen % recipeIds.length]
        chosen = Math.floor(chosen / recipeIds.length)
        return { day, recipeId }
      })

      // Independent, day-based oracle: duplicate lines inside one recipe
      // would still contribute at most one day to a reused ingredient.
      const expected = new Map()
      for (const day of activeDays) {
        const selected = plan.find((meal) => meal.day === day)
        const recipe = byId.get(selected.recipeId)
        for (const ingredientId of new Set(recipe.ingredients.map((item) => item.id))) {
          const days = expected.get(ingredientId) ?? []
          days.push(day)
          expected.set(ingredientId, days)
        }
      }

      const actual = buildIngredientReuseInsight({ plan, recipes: m2Recipes, activeDays })
      assert.ok(actual)
      assert.equal(actual.activeMealCount, activeDays.length)
      assert.equal(actual.distinctIngredientCount, expected.size)
      const expectedReuse = [...expected].filter(([, days]) => days.length > 1)
      assert.equal(actual.reusedIngredients.length, expectedReuse.length)
      for (const result of actual.reusedIngredients) {
        const days = expected.get(result.ingredientId)
        assert.ok(days)
        assert.deepEqual(result.days, days)
        assert.equal(result.mealCount, days.length)
        assert.deepEqual(
          result.recipeIds,
          days.map((day) => plan.find((meal) => meal.day === day).recipeId),
        )
      }
      assert.deepEqual(
        actual.reusedIngredients.map((line) => line.mealCount),
        [...actual.reusedIngredients.map((line) => line.mealCount)].sort((a, b) => b - a),
      )
      combinations++
    }
  }
  assert.equal(combinations, 1215)
})

test('reordering input recipe and plan catalogs cannot change the same current-week explanation', () => {
  const base = buildIngredientReuseInsight({
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: allDays,
  })
  assert.ok(base)
  for (const recipes of [m2Recipes, [...m2Recipes].reverse()]) {
    for (const plan of [m2InitialPlan, [...m2InitialPlan].reverse()]) {
      assert.deepEqual(
        buildIngredientReuseInsight({ plan, recipes, activeDays: allDays }),
        base,
      )
    }
  }
})
