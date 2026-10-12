import assert from 'node:assert/strict'
import test from 'node:test'

import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  defaultPlannerPreferences,
  parsePlannerPreferences,
  serializePlannerPreferences,
} from '../src/domain/plannerPreferences.ts'
import {
  MAX_CUSTOM_WEEK_BUDGET_CENTS,
  parseCustomWeekBudgetCents,
  restorePlannerPreferencesWithCustomBudget,
  validCustomWeekBudgetEuros,
} from '../src/features/planner/customWeekBudget.ts'

// Product #1424: a separate, deterministic *full-cent-range* contract atop the
// existing App/Planner compiled-TSX clickthrough proof. No retailer price or
// customer data: budgets below are synthetic user input, not savings evidence.
const recipeIds = m2Recipes.map(recipe => recipe.id)

test('product #1424: each cent from €0,01 through €1.000,00 parses without cent drift', () => {
  assert.equal(MAX_CUSTOM_WEEK_BUDGET_CENTS, 100_000)
  for (let cents = 1; cents <= MAX_CUSTOM_WEEK_BUDGET_CENTS; cents++) {
    const euros = Math.floor(cents / 100)
    const fraction = String(cents % 100).padStart(2, '0')
    const dutch = `${euros},${fraction}`
    const international = `${euros}.${fraction}`
    assert.equal(parseCustomWeekBudgetCents(dutch), cents, dutch)
    assert.equal(parseCustomWeekBudgetCents(international), cents, international)
    assert.equal(validCustomWeekBudgetEuros(cents / 100), cents / 100, dutch)
  }
})

test('product #1424: reject ambiguous grouping and amounts that cannot represent whole cents', () => {
  for (const value of [
    '', ' ', '0', '0,00', '00,01', '01,00', '-0,01', '+1', '1e2',
    '1,234', '2.500,00', '1.000', '1.000.00', '1,000.00',
    '1000,01', '1001', 'NaN', 'Infinity', '.50', ',50',
    '€ 27,50', '12 34', '12\u00a034', '27\u200b,50',
    '\u0662\u0667,\u0665\u0660', null, undefined, 27.5, {},
  ]) {
    assert.equal(parseCustomWeekBudgetCents(value), null, JSON.stringify(value))
  }
  assert.equal(parseCustomWeekBudgetCents('1.000,00'), 100_000)
  assert.equal(parseCustomWeekBudgetCents('1.000,0'), 100_000)
  assert.equal(parseCustomWeekBudgetCents(' 27,50 '), 2750)
  assert.equal(validCustomWeekBudgetEuros(27.501), null)
  assert.equal(validCustomWeekBudgetEuros(1000.01), null)
  assert.equal(validCustomWeekBudgetEuros(0), null)
})

test('product #1424: selected custom amount survives JSON roundtrip at lower and upper bounds', () => {
  const original = defaultPlannerPreferences(m2InitialPlan)
  for (const cents of [1, 2, 29, 99, 100, 101, 2750, 4275, 99999, 100000]) {
    const chosen = { ...original, budget: cents / 100 }
    const raw = serializePlannerPreferences(chosen)
    const restored = restorePlannerPreferencesWithCustomBudget(raw, m2InitialPlan, recipeIds)
    assert.deepEqual(restored, chosen, `failed for ${cents} cents`)
  }
  // The shared strict chip-only parser is intentionally not expanded.
  const persisted = serializePlannerPreferences({ ...original, budget: 27.5 })
  assert.equal(parsePlannerPreferences(persisted, m2InitialPlan, recipeIds).budget, 35)
  assert.equal(restorePlannerPreferencesWithCustomBudget(persisted, m2InitialPlan, recipeIds).budget, 27.5)
})

test('product #1424: custom budget cannot authorize stale day/recipe preferences', () => {
  const originalPlan = structuredClone(m2InitialPlan)
  const idsBefore = [...recipeIds]
  const raw = JSON.stringify({
    budget: 42.75,
    activeDays: ['not-a-planned-day'],
    recipeByDay: Object.fromEntries(m2InitialPlan.map(({ day }) => [day, 'unlicensed-recipe'])),
  })
  const restored = restorePlannerPreferencesWithCustomBudget(raw, m2InitialPlan, recipeIds)
  const fallback = defaultPlannerPreferences(m2InitialPlan)
  assert.equal(restored.budget, 42.75)
  assert.deepEqual(restored.activeDays, fallback.activeDays)
  assert.deepEqual(restored.recipeByDay, fallback.recipeByDay)
  assert.deepEqual(m2InitialPlan, originalPlan)
  assert.deepEqual(recipeIds, idsBefore)
  assert.equal(raw.includes('unlicensed-recipe'), true)
})

test('product #1424: malformed persisted budget fails closed while retaining safe plan choices', () => {
  const fallback = defaultPlannerPreferences(m2InitialPlan)
  for (const invalid of [0, -1, 27.501, 1000.01, null, '27,50', {}, [], false]) {
    const restored = restorePlannerPreferencesWithCustomBudget(
      JSON.stringify({ ...fallback, budget: invalid, activeDays: [] }),
      m2InitialPlan,
      recipeIds,
    )
    assert.equal(restored.budget, 35, String(invalid))
    assert.deepEqual(restored.activeDays, [], String(invalid))
  }
  assert.deepEqual(
    restorePlannerPreferencesWithCustomBudget('{broken', m2InitialPlan, recipeIds),
    fallback,
  )
})
