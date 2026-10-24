import assert from 'node:assert/strict'
import test from 'node:test'

import { buildIngredientReuseInsight } from '../src/domain/ingredientReuse.ts'
import { formatShareableWeek } from '../src/features/planner/weekPlanShare.ts'
import {
  m2InitialPlan,
  m2Recipes,
  m2DefaultActiveDays,
} from '../src/data/m2Fixture.ts'

// Synthetic fixture matrix only. Ingredient reuse indicates shared recipes,
// NEVER packets saved, lower costs, observed supermarket prices, or M3 proof.
const DAYS = m2InitialPlan.map((meal) => meal.day)
const recipeById = new Map(m2Recipes.map((recipe) => [recipe.id, recipe]))
function planFor(code) {
  const choices = m2Recipes.map((recipe) => recipe.id)
  return DAYS.map((day, index) => ({
    day,
    recipeId: choices[Math.floor(code / (choices.length ** index)) % choices.length],
  }))
}
function activeFor(mask) {
  return DAYS.filter((_, i) => (mask & (1 << i)) !== 0)
}
function independentUsage(plan, days) {
  const byId = new Map()
  for (const day of days) {
    const selected = plan.find((item) => item.day === day)
    const recipe = recipeById.get(selected.recipeId)
    for (const ingredient of recipe.ingredients) {
      const previous = byId.get(ingredient.id) ?? {
        ingredientId: ingredient.id, label: ingredient.label,
        days: [], recipeIds: [], mealCount: 0,
      }
      if (!previous.days.includes(day)) {
        previous.days.push(day)
        previous.recipeIds.push(recipe.id)
        previous.mealCount += 1
      }
      byId.set(ingredient.id, previous)
    }
  }
  return {
    distinctIngredientCount: byId.size,
    shared: [...byId.values()].filter((item) => item.mealCount >= 2)
      .sort((a, b) => b.mealCount - a.mealCount ||
        (a.ingredientId < b.ingredientId ? -1 : a.ingredientId > b.ingredientId ? 1 : 0)),
  }
}

test('all 1296 active-week combinations: overlap and manual share agree on exactly selected meals', () => {
  const fixtureBefore = JSON.stringify([m2InitialPlan, m2Recipes, m2DefaultActiveDays])
  let checked = 0
  for (let planCode = 0; planCode < (m2Recipes.length ** DAYS.length); planCode += 1) {
    const plannedMeals = planFor(planCode)
    for (let dayMask = 0; dayMask < (1 << DAYS.length); dayMask += 1) {
      const activeDays = activeFor(dayMask)
      const before = JSON.stringify([plannedMeals, activeDays])
      const expected = independentUsage(plannedMeals, activeDays)
      const insight = buildIngredientReuseInsight({ plan: plannedMeals, recipes: m2Recipes, activeDays })
      const share = formatShareableWeek({
        plannedMeals, recipes: m2Recipes, activeDays,
        budget: 35, includeBudget: false, includeDetails: false,
      })
      const lines = share.split('\n')
      const copiedMeals = lines.filter((line) => DAYS.some((day) => line.startsWith(day + ': ')))
      assert.deepEqual(copiedMeals, activeDays.map((day) => {
        const recipeId = plannedMeals.find((meal) => meal.day === day).recipeId
        return day + ': ' + recipeById.get(recipeId).title
      }), 'manual copy must never contain an inactive meal or a stale recipe')
      assert.doesNotMatch(share, /weekbudget|€|[0-9][,.][0-9]{2}|besparing bewezen|porties|\d+ min/i,
        'no personal budget, estimated money, or details without explicit opt-in')
      assert.match(share, /Dit is een planning, geen prijsopgave\./)

      if (activeDays.length === 0) {
        assert.equal(insight, null, 'empty week must not invent reuse')
        assert.match(share, /Geen maaltijden geselecteerd\./)
      } else {
        assert.ok(insight, 'valid nonempty plan must provide an explanation')
        assert.equal(insight.activeMealCount, activeDays.length)
        assert.equal(insight.distinctIngredientCount, expected.distinctIngredientCount)
        assert.deepEqual(insight.reusedIngredients, expected.shared,
          'shared labels and day/recipe attribution must match independent fixture oracle')
      }
      assert.equal(JSON.stringify([plannedMeals, activeDays]), before, 'never mutate selected plan')
      checked += 1
    }
  }
  assert.equal(checked, 1296)
  assert.equal(JSON.stringify([m2InitialPlan, m2Recipes, m2DefaultActiveDays]), fixtureBefore)
})

test('user-changed active days rederive overlap but sharing remains private, offline, and independent of ingredient hints', () => {
  const plan = planFor(0)
  const allDays = buildIngredientReuseInsight({
    plan, recipes: m2Recipes, activeDays: DAYS,
  })
  const oneDay = buildIngredientReuseInsight({
    plan, recipes: m2Recipes, activeDays: [DAYS[0]],
  })
  assert.ok(allDays.reusedIngredients.length > 0)
  assert.deepEqual(oneDay.reusedIngredients, [])
  const defaultShare = formatShareableWeek({
    plannedMeals: plan, recipes: m2Recipes, activeDays: [DAYS[0]], budget: 35,
  })
  assert.deepEqual(defaultShare.split('\n').filter((line) => line.startsWith(DAYS[0] + ': ')),
    [DAYS[0] + ': ' + recipeById.get(plan[0].recipeId).title])
  assert.doesNotMatch(defaultShare, /Weekbudget \(eigen voorkeur\)|€/)
  assert.equal((defaultShare.match(/Dit is een planning, geen prijsopgave\./g) ?? []).length, 1)

  const privateOptIn = formatShareableWeek({
    plannedMeals: plan, recipes: m2Recipes, activeDays: [DAYS[0]],
    budget: 35, includeBudget: true,
  })
  assert.match(privateOptIn, /Weekbudget \(eigen voorkeur\):/)
  assert.notEqual(privateOptIn, defaultShare)
  assert.deepEqual(buildIngredientReuseInsight({plan, recipes: m2Recipes, activeDays: [DAYS[0]]}),
    oneDay, 'budget opt-in must not affect ingredient calculations')
})
