import assert from 'node:assert/strict'
import test from 'node:test'

import { getBudgetState, getPlannedCost } from '../src/domain/planner.ts'

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
