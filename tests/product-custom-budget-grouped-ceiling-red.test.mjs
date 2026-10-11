import assert from 'node:assert/strict'
import test from 'node:test'

import {
  customWeekBudgetLabel,
  parseCustomWeekBudget,
  parsePlannerPreferencesWithCustomBudget,
} from '../src/domain/customPlannerBudget.ts'
import {
  defaultPlannerPreferences,
  parsePlannerPreferences,
  serializePlannerPreferences,
} from '../src/domain/plannerPreferences.ts'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'

// Synthetic product-core reproduction for #1424 on immutable DRAFT #1514.
// The *visible* upper bound is written as "€1.000,00", but that same explicit
// Dutch thousands+decimal form is rejected by the current opt-in parser.
// No financial observations, store prices, permissions or M3 proof.
const recipes = m2Recipes.map((recipe) => recipe.id)

test('RED #1424: the explicitly advertised Dutch ceiling €1.000,00 submits as exact 100000 cents', () => {
  assert.equal(parseCustomWeekBudget('1.000,00'), 1000)
  assert.equal(parseCustomWeekBudget(' 1.000,00 '), 1000)
  assert.equal(parseCustomWeekBudget('1.000,0'), 1000)
})

test('ungrouped decimal budget input remains accepted with exact integer-cent canonical round trips', () => {
  for (const [raw, amount] of [
    ['0,01', 0.01], ['0.1', 0.1], ['27,50', 27.5],
    ['42.75', 42.75], ['999,99', 999.99], ['1000,00', 1000],
    ['1000.00', 1000],
  ]) {
    assert.equal(parseCustomWeekBudget(raw), amount)
    const label = customWeekBudgetLabel(amount)
    assert.ok(label)
    assert.equal(parseCustomWeekBudget(label), amount)
  }
})

test('grouping ambiguity, invalid separators, subcents and over-ceiling remain rejected', () => {
  for (const raw of [
    '1.000', '1,000', '1,000.00', '1.00,00', '01.000,00',
    '1..000,00', '1.000,000', '1.000,01', '2.000,00',
    '1.000.00', '0.000,01', '1 000,00', '1\u00a0000,00',
    '-1.000,00', '0,00', '0.001', '1e3', 'NaN',
  ]) {
    assert.equal(parseCustomWeekBudget(raw), null, `must not reinterpret ${raw}`)
  }
})

test('existing persisted custom values stay exact and legacy chip-only parser remains strict', () => {
  const base = defaultPlannerPreferences(m2InitialPlan)
  const original = {
    ...base, budget: 1000, activeDays: ['Di'],
  }
  const bytes = serializePlannerPreferences(original)
  const restored = parsePlannerPreferencesWithCustomBudget(bytes, m2InitialPlan, recipes)
  assert.equal(restored.budget, 1000)
  assert.deepEqual(restored.activeDays, ['Di'])
  assert.equal(
    parsePlannerPreferences(bytes, m2InitialPlan, recipes).budget,
    35,
    'opt-in must not silently expand the legacy valid-budget list',
  )
  assert.equal(serializePlannerPreferences(original), bytes,
    'read-only validation must not rewrite the serialized preferences')
})
