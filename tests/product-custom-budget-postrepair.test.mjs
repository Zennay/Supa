import assert from 'node:assert/strict'
import test from 'node:test'
import {
  customWeekBudgetLabel,
  parseCustomWeekBudget,
  parsePlannerPreferencesWithCustomBudget,
} from '../src/domain/customPlannerBudget.ts'
import { defaultPlannerPreferences, serializePlannerPreferences } from '../src/domain/plannerPreferences.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'

// Independent product acceptance: real persisted planner preferences, synthetic
// basket-cent totals only. This does not establish live retailer prices.
const recipeIds = m2Recipes.map(recipe => recipe.id)

test('independent: all representative custom cents survive Dutch input + JSON roundtrip', () => {
  for (const budgetCents of [1, 2, 5, 10, 29, 99, 100, 101, 299, 2750, 2999,
    3500, 3575, 4075, 99999, 100000]) {
    const euros = budgetCents / 100
    const label = customWeekBudgetLabel(euros)
    assert.equal(parseCustomWeekBudget(label), euros, label)
    const expected = {
      budget: euros,
      activeDays: ['Ma', 'Wo'],
      recipeByDay: { Ma: 'tikka', Di: 'pasta', Wo: 'pasta', Do: 'teriyaki' },
    }
    const restored = parsePlannerPreferencesWithCustomBudget(
      serializePlannerPreferences(expected),
      m2InitialPlan, recipeIds,
    )
    assert.deepEqual(restored, expected)
  }
})

test('independent: chip, custom, chip sequence never damages plan or recipe selection', () => {
  const initial = defaultPlannerPreferences(m2InitialPlan)
  let current = { ...initial, activeDays: ['Ma', 'Do'],
    recipeByDay: { ...initial.recipeByDay, Do: 'pasta' } }
  for (const budget of [30, 27.5, 35, 42.75, 40, 0.01, 1000]) {
    current = { ...current, budget }
    current = parsePlannerPreferencesWithCustomBudget(
      serializePlannerPreferences(current),
      m2InitialPlan, recipeIds,
    )
    assert.equal(current.budget, budget)
    assert.deepEqual(current.activeDays, ['Ma', 'Do'])
    assert.equal(current.recipeByDay.Do, 'pasta')
  }
})

test('independent: poisoned persisted amounts cannot override safe fallback or mutate active days', () => {
  for (const budget of [0, -1, 0.001, 3.333, 35.0001, 1000.01,
    Number.MAX_VALUE, '27,50', {}, []]) {
    const preferences = parsePlannerPreferencesWithCustomBudget(JSON.stringify({
      budget, activeDays: ['Wo'], recipeByDay: { Wo: 'pasta' },
    }), m2InitialPlan, recipeIds)
    assert.equal(preferences.budget, 35)
    assert.deepEqual(preferences.activeDays, ['Wo'])
    assert.equal(preferences.recipeByDay.Wo, 'pasta')
  }
})

test('independent: malformed storage cannot make future budget arithmetic claimable', () => {
  for (const raw of ['{', '[]', 'null', '"27,50"', 'false']) {
    const restored = parsePlannerPreferencesWithCustomBudget(raw, m2InitialPlan, recipeIds)
    assert.equal(restored.budget, 35)
  }
  const budget = assessPlannerBudgetCents(1969, 42.75, 0)
  assert.equal(budget.status, 'known')
  assert.equal(budget.remainingCents, 2306)
  assert.equal(budget.overBudget, false)
  const incomplete = assessPlannerBudgetCents(1969, 42.75, 1)
  assert.equal(incomplete.status, 'unknown')
  assert.equal(incomplete.reason, 'unresolved-products')
  assert.equal('remainingCents' in incomplete, false)
})
