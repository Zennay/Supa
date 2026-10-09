import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { assessPlannerBudget } from '../src/domain/planner.ts'
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
const defaultRecipes = Object.fromEntries(m2InitialPlan.map(({ day, recipeId }) => [day, recipeId]))

function restoreAndAssess({ budget, activeDays, recipeByDay }) {
  const restored = parsePlannerPreferences(
    serializePlannerPreferences({ budget, activeDays, recipeByDay }),
    m2InitialPlan,
    recipeIds,
  )
  const basket = buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan.map(({ day }) => ({ day, recipeId: restored.recipeByDay[day] })),
    recipes: m2Recipes,
    activeDays: restored.activeDays,
    products: m2Products,
  })
  return {
    basket,
    assessment: assessPlannerBudget(
      basket.totalCents / 100,
      restored.budget,
      basket.unresolvedLineCount,
    ),
  }
}

test('an unresolved active ingredient prevents an affordability claim after planner reload', () => {
  for (const budget of [30, 35, 40]) {
    const { basket, assessment } = restoreAndAssess({
      budget,
      activeDays: ['Ma', 'Di', 'Wo', 'Do'],
      recipeByDay: defaultRecipes,
    })
    assert.ok(basket.unresolvedLineCount > 0)
    assert.equal(assessment.status, 'unknown')
    assert.equal(assessment.budget, budget)
    assert.equal(assessment.knownCost, basket.totalCents / 100)
    assert.equal(assessment.unresolvedLineCount, basket.unresolvedLineCount)
    assert.equal(Object.hasOwn(assessment, 'budgetState'), false)
  }
})

test('a resolved single-meal week can show a budget state after reload', () => {
  for (const budget of [30, 35, 40]) {
    const { basket, assessment } = restoreAndAssess({
      budget,
      activeDays: ['Wo'],
      recipeByDay: defaultRecipes,
    })
    assert.equal(basket.selectedMealCount, 1)
    assert.equal(basket.unresolvedLineCount, 0)
    assert.equal(assessment.status, 'known')
    assert.equal(assessment.budgetState.plannedCost, basket.totalCents / 100)
    assert.equal(assessment.budgetState.budget, budget)
  }
})

test('an unresolved recipe on an inactive day never contaminates the known weekly budget', () => {
  const { basket, assessment } = restoreAndAssess({
    budget: 35,
    activeDays: ['Wo'],
    recipeByDay: { Ma: 'tikka', Di: 'tikka', Wo: 'pasta', Do: 'tikka' },
  })

  assert.equal(basket.lines.some((line) => line.id === 'garam-masala'), false)
  assert.equal(assessment.status, 'known')
  assert.equal(assessment.budgetState.plannedCost, basket.totalCents / 100)
})

test('a persisted zero-meal week keeps zero budget usage without phantom demand', () => {
  const { basket, assessment } = restoreAndAssess({
    budget: 35,
    activeDays: [],
    recipeByDay: defaultRecipes,
  })
  assert.equal(basket.selectedMealCount, 0)
  assert.equal(basket.totalCents, 0)
  assert.deepEqual(basket.lines, [])
  assert.equal(assessment.status, 'known')
  assert.equal(assessment.budgetState.remaining, 35)
  assert.equal(assessment.budgetState.usage, 0)
})
