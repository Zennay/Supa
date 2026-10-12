import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseCustomWeekBudgetCents,
  validCustomWeekBudgetEuros,
  restorePlannerPreferencesWithCustomBudget,
} from '../src/features/planner/customWeekBudget.ts'
import {
  defaultPlannerPreferences,
  parsePlannerPreferences,
} from '../src/domain/plannerPreferences.ts'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'

const recipeIds = m2Recipes.map(recipe => recipe.id)

test('product #1424: the displayed Dutch ceiling €1.000,00 must be accepted exactly [expected RED]', () => {
  assert.equal(parseCustomWeekBudgetCents('1.000,00'), 100_000)
  assert.equal(parseCustomWeekBudgetCents('1.000,0'), 100_000)
  assert.equal(parseCustomWeekBudgetCents('  1.000,00  '), 100_000)
  assert.equal(parseCustomWeekBudgetCents('1000,00'), 100_000)
  assert.equal(parseCustomWeekBudgetCents('1000.00'), 100_000)
})

test('product #1424: grouping is only permitted for the unambiguous displayed ceiling', () => {
  for (const invalid of [
    '1.000', '1.000.00', '1.000,', '1.000,000', '1.000,01',
    '1,000.00', '1 000,00', '1.00,00', '01.000,00',
    '2.000,00', '-1.000,00', '+1.000,00', '1e3',
    '', '0', '0,00', '0,001', '1000,01', '1001', '999,999',
  ]) {
    assert.equal(parseCustomWeekBudgetCents(invalid), null, invalid)
  }
  for (const [text, cents] of [['0,01', 1], ['27,50', 2750], ['999,99', 99999]]) {
    assert.equal(parseCustomWeekBudgetCents(text), cents)
  }
})

test('product #1424: grouped input commits the same cent-exact persisted budget as ungrouped text', () => {
  const cents = parseCustomWeekBudgetCents('1.000,00')
  assert.equal(cents, 100_000)
  const numericBudget = cents / 100
  assert.equal(validCustomWeekBudgetEuros(numericBudget), 1000)
  const raw = JSON.stringify({
    ...defaultPlannerPreferences(m2InitialPlan),
    budget: numericBudget,
  })
  const restored = restorePlannerPreferencesWithCustomBudget(raw, m2InitialPlan, recipeIds)
  assert.equal(restored.budget, 1000)
  assert.equal(parsePlannerPreferences(raw, m2InitialPlan, recipeIds).budget, 35,
    'legacy restricted-chip API is intentionally unchanged')
})
