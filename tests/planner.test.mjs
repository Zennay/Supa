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
