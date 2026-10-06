import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assessPlannerBudget,
  getBudgetState,
  getPlannedCost,
} from '../src/domain/planner.ts'

const recipes = [
  { id: 'cheap', title: 'Cheap', minutes: 10, servings: 2, estimatedCost: 4.5, tags: [] },
  { id: 'meal', title: 'Meal', minutes: 20, servings: 2, estimatedCost: 7.25, tags: [] },
]

const plan = [
  { day: 'Ma', recipeId: 'cheap' },
  { day: 'Di', recipeId: 'meal' },
  { day: 'Wo', recipeId: 'cheap' },
]

test('planned cost only includes active planner days', () => {
  assert.equal(getPlannedCost(plan, recipes, ['Ma', 'Wo']), 9)
})

test('planned cost fails closed when an active recipe identity is missing', () => {
  assert.equal(
    getPlannedCost([{ day: 'Ma', recipeId: 'missing' }], recipes, ['Ma']),
    null,
  )
})

test('planned cost fails closed when an active recipe identity is ambiguous', () => {
  const duplicateRecipes = [
    ...recipes,
    {
      id: 'cheap',
      title: 'Conflicting cheap',
      minutes: 15,
      servings: 2,
      estimatedCost: 99,
      tags: [],
    },
  ]

  assert.equal(getPlannedCost(plan, duplicateRecipes, ['Ma']), null)
})

test('inactive unresolved recipe identities do not invalidate the active planned cost', () => {
  assert.equal(
    getPlannedCost(
      [...plan, { day: 'Do', recipeId: 'missing' }],
      recipes,
      ['Ma'],
    ),
    4.5,
  )
})


test('planned cost fails closed when an active day has no planned meal', () => {
  assert.equal(getPlannedCost(plan, recipes, ['Ma', 'Do']), null)
})

test('planned cost fails closed when an active day has duplicate planned meals', () => {
  assert.equal(
    getPlannedCost(
      [...plan, { day: 'Ma', recipeId: 'meal' }],
      recipes,
      ['Ma'],
    ),
    null,
  )
})

test('duplicate active-day input does not double count a valid planned meal', () => {
  assert.equal(getPlannedCost(plan, recipes, ['Ma', 'Ma']), 4.5)
})

test('planned cost fails closed on malformed active recipe estimates', () => {
  for (const invalidCost of [Number.NaN, Number.POSITIVE_INFINITY, -1, '4.5', null]) {
    const malformedRecipes = recipes.map((recipe) =>
      recipe.id === 'cheap' ? { ...recipe, estimatedCost: invalidCost } : recipe,
    )

    assert.equal(getPlannedCost(plan, malformedRecipes, ['Ma']), null)
  }
})

test('planned cost rejects malformed runtime collection containers without throwing', () => {
  for (const [runtimePlan, runtimeRecipes, runtimeActiveDays] of [
    [null, recipes, ['Ma']],
    [{}, recipes, ['Ma']],
    [plan, null, ['Ma']],
    [plan, 'recipes', ['Ma']],
    [plan, recipes, null],
    [plan, recipes, 'Ma'],
  ]) {
    assert.doesNotThrow(() => {
      assert.equal(
        getPlannedCost(runtimePlan, runtimeRecipes, runtimeActiveDays),
        null,
      )
    })
  }
})

test('planned cost fails closed on malformed active runtime identities and entries', () => {
  assert.equal(getPlannedCost(plan, recipes, [42]), null)
  assert.equal(
    getPlannedCost([{ day: 'Ma' }], recipes, ['Ma']),
    null,
  )
  assert.equal(
    getPlannedCost([null, ...plan], [null, ...recipes], ['Ma']),
    4.5,
  )
})

test('budget state exposes remaining money and usage', () => {
  const state = getBudgetState(23.5, 35)

  assert.equal(state.remaining, 11.5)
  assert.equal(state.overBudget, false)
  assert.equal(state.usage, 23.5 / 35)
})

test('budget state caps progress and marks overspend', () => {
  const state = getBudgetState(42, 35)

  assert.equal(state.remaining, -7)
  assert.equal(state.usage, 1)
  assert.equal(state.overBudget, true)
})

test('planner budget outcome is claimable only for a complete basket', () => {
  const assessment = assessPlannerBudget(23.5, 35, 0)

  assert.equal(assessment.status, 'known')
  assert.equal(assessment.budgetState.remaining, 11.5)
  assert.equal(assessment.budgetState.overBudget, false)
})

test('planner budget outcome fails closed when product matches are unresolved', () => {
  const assessment = assessPlannerBudget(23.5, 35, 2)

  assert.deepEqual(assessment, {
    status: 'unknown',
    knownCost: 23.5,
    budget: 35,
    unresolvedLineCount: 2,
  })
})

test('planner budget outcome treats invalid unresolved counts as unknown', () => {
  for (const unresolvedLineCount of [Number.NaN, -1]) {
    const assessment = assessPlannerBudget(23.5, 35, unresolvedLineCount)

    assert.equal(assessment.status, 'unknown')
    assert.equal(assessment.unresolvedLineCount, 1)
  }
})

test('planner budget outcome rejects malformed runtime money without coercion', () => {
  for (const malformedKnownCost of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    '23.5',
    null,
    undefined,
    true,
  ]) {
    const assessment = assessPlannerBudget(malformedKnownCost, 35, 0)

    assert.deepEqual(assessment, {
      status: 'unknown',
      knownCost: 0,
      budget: 35,
      unresolvedLineCount: 1,
    })
  }

  for (const malformedBudget of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    '35',
    null,
    undefined,
    true,
  ]) {
    const assessment = assessPlannerBudget(23.5, malformedBudget, 0)

    assert.deepEqual(assessment, {
      status: 'unknown',
      knownCost: 23.5,
      budget: 0,
      unresolvedLineCount: 1,
    })
  }
})

test('planner budget outcome requires a safe non-negative unresolved count', () => {
  for (const malformedCount of [
    '0',
    null,
    undefined,
    true,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const assessment = assessPlannerBudget(23.5, 35, malformedCount)

    assert.equal(assessment.status, 'unknown')
    assert.equal(assessment.unresolvedLineCount, 1)
  }
})

