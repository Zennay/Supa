import assert from 'node:assert/strict'
import test from 'node:test'
import { assessPlannerBudget, getBudgetState, getPlannedCost } from '../src/domain/planner.ts'
import { euro } from '../src/lib/money.ts'

// All money here is deliberately synthetic planner input, not observed
// supermarket prices, licensed price data or a savings claim.
test('M3 planner formats precise remaining budget instead of a false unavailable dash', () => {
  const state = getBudgetState(19.69, 35)
  assert.equal(state.remaining, 15.31)
  assert.equal(euro.format(state.remaining), '€\u00a015,31')
  assert.equal(state.overBudget, false)
  assert.equal(state.budget, 35)
  assert.equal(state.plannedCost, 19.69)
})

test('M3 budget exact overspend and equality preserve truthful visible direction', () => {
  for (const [cost, budget, remaining, over] of [
    [35.01, 35, -0.01, true],
    [35, 35, 0, false],
    [0.01, 35, 34.99, false],
    [0.01, 0, -0.01, true],
  ]) {
    const result = assessPlannerBudget(cost, budget, 0)
    assert.equal(result.status, 'known')
    assert.equal(result.budgetState.remaining, remaining)
    assert.equal(result.budgetState.overBudget, over)
    assert.notEqual(euro.format(result.budgetState.remaining), '—')
  }
})

test('M3 rejects unsafe or unresolved planner assessment rather than guessing a remainder', () => {
  const incomplete = assessPlannerBudget(19.69, 35, 1)
  assert.equal(incomplete.status, 'unknown')
  assert.equal('budgetState' in incomplete, false)
  for (const [price, budget] of [
    [Number.NaN, 35], [19.69, Number.POSITIVE_INFINITY],
    ['19.69', 35], [19.69, null], [-1, 35],
  ]) {
    const result = assessPlannerBudget(price, budget, 0)
    assert.equal(result.status, 'unknown')
    assert.equal('budgetState' in result, false)
  }
})

test('M3 does not round a genuine sub-cent amount into a quoted cent value', () => {
  assert.equal(euro.format(1.001), '—')
  assert.equal(euro.format(getBudgetState(1.001, 35).remaining), '—')
  assert.equal(getBudgetState(19.69, 35).remaining, 15.31)
})

test('M3 malformed active plan identities fail closed, valid example still calculates', () => {
  const plan = [{ day: 'Ma', recipeId: 'meal-a' }]
  const recipes = [{ id: 'meal-a', estimatedCost: 19.69 }]
  assert.equal(getPlannedCost(plan, recipes, ['Ma']), 19.69)
  assert.equal(getPlannedCost(plan, recipes, [' Ma']), null)
  assert.equal(getPlannedCost([{day:'Ma',recipeId:'meal-a '}], recipes, ['Ma']), null)
  assert.equal(getPlannedCost(null, recipes, ['Ma']), null)
})
