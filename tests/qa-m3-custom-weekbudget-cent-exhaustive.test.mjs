import assert from 'node:assert/strict'
import test from 'node:test'

import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import { parsePlannerPreferences } from '../src/domain/plannerPreferences.ts'
import {
  MAX_CUSTOM_WEEK_BUDGET_CENTS,
  parseCustomWeekBudgetCents,
  restorePlannerPreferencesWithCustomBudget,
  validCustomWeekBudgetEuros,
} from '../src/features/planner/customWeekBudget.ts'

// Independent integer-cent oracle: the index IS the expected cent amount.
// No basket prices, users, retailer requests or storage writes are involved.
function decimalText(cents, separator) {
  const euroPart = Math.floor(cents / 100)
  const centPart = String(cents % 100).padStart(2, '0')
  return `${euroPart}${separator}${centPart}`
}

test('QA M3: every permitted cent budget round-trips through comma, dot and exact stored numeric validation', () => {
  assert.equal(MAX_CUSTOM_WEEK_BUDGET_CENTS, 100_000)
  let count = 0
  for (let cents = 1; cents <= MAX_CUSTOM_WEEK_BUDGET_CENTS; cents++) {
    const dutch = decimalText(cents, ',')
    const dotted = decimalText(cents, '.')
    const euros = cents / 100
    assert.equal(parseCustomWeekBudgetCents(dutch), cents, dutch)
    assert.equal(parseCustomWeekBudgetCents(dotted), cents, dotted)
    assert.equal(validCustomWeekBudgetEuros(euros), euros, dutch)
    count++
  }
  assert.equal(count, 100_000)
})

test('QA M3: persisted custom budgets preserve canonical days and recipes across the complete range', () => {
  const ids = m2Recipes.map((recipe) => recipe.id)
  let count = 0
  // Cover the bottom edge, all distinct 97-cent residues, and the maximum.
  const candidates = new Set([1, 2, 9, 10, 99, 100, 101, 2750, 4275, 100000])
  for (let cents = 1; cents <= MAX_CUSTOM_WEEK_BUDGET_CENTS; cents += 97) candidates.add(cents)

  for (const cents of candidates) {
    const budget = cents / 100
    const raw = JSON.stringify({
      budget,
      activeDays: ['Ma', 'Do'],
      recipeByDay: { Ma: 'pasta', Do: 'tikka' },
    })
    const restored = restorePlannerPreferencesWithCustomBudget(raw, m2InitialPlan, ids)
    assert.equal(restored.budget, budget, String(cents))
    assert.deepEqual(restored.activeDays, ['Ma', 'Do'], String(cents))
    assert.equal(restored.recipeByDay.Ma, 'pasta', String(cents))
    assert.equal(restored.recipeByDay.Do, 'tikka', String(cents))
    // The underlying old chip-only domain parser stays deliberately strict.
    const original = parsePlannerPreferences(raw, m2InitialPlan, ids)
    if (![30, 35, 40].includes(budget)) {
      assert.equal(original.budget, 35, String(cents))
    }
    count++
  }
  assert.ok(count >= 1000, 'Broad cent-residue persistence sampling is required')
})

test('QA M3: no third-decimal injection, forced leading zero or over-range value may become a valid cent', () => {
  const ids = m2Recipes.map((recipe) => recipe.id)
  for (let cents = 1; cents <= MAX_CUSTOM_WEEK_BUDGET_CENTS; cents += 101) {
    const eu = Math.floor(cents / 100)
    const fractional = String(cents % 100).padStart(2, '0')
    assert.equal(parseCustomWeekBudgetCents(`${eu},${fractional}1`), null, String(cents))
    assert.equal(parseCustomWeekBudgetCents(`0${eu},${fractional}`), null, String(cents))
    const stored = JSON.stringify({
      budget: cents / 100 + 0.001,
      activeDays: ['Ma'],
      recipeByDay: { Ma: 'pasta' },
    })
    assert.equal(restorePlannerPreferencesWithCustomBudget(stored, m2InitialPlan, ids).budget, 35, String(cents))
  }
  for (const value of ['0,00', '1000,01', '1,005', '1.000,00', '01,00', '+35,00', '-35,00', '1e2', 'Infinity', 'NaN']) {
    assert.equal(parseCustomWeekBudgetCents(value), null, value)
  }
})
