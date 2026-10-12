import assert from 'node:assert/strict'
import test from 'node:test'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import { parsePlannerPreferences } from '../src/domain/plannerPreferences.ts'
import {
  parseCustomWeekBudgetCents,
  validCustomWeekBudgetEuros,
  restorePlannerPreferencesWithCustomBudget,
} from '../src/features/planner/customWeekBudget.ts'

const recipeIds = m2Recipes.map(recipe => recipe.id)
test('product #1424: Dutch custom week budget text is parsed without float rounding', () => {
  for (const [text, cents] of [['27,50',2750], ['42.75',4275], ['0,01',1], ['1000,00',100000], ['35',3500], ['2,5',250], [' 12,09 ',1209], ['000',null]]) {
    assert.equal(parseCustomWeekBudgetCents(text), cents, text)
  }
})
test('product #1424: malformed, sub-cent, negative and too large budgets never commit', () => {
  for (const input of ['',' ','0','0,00','-1','+1','1,005','3.999,00','1e3','01,20','12,','12.345','1000,01','9999','Infinity','NaN','0.1.2','€27,50',null,42]) {
    assert.equal(parseCustomWeekBudgetCents(input), null, String(input))
  }
})
test('product #1424: persisted budgets restore exact cents and intact meal preferences', () => {
  for (const budget of [0.01, 27.5, 42.75, 1000]) {
    const raw = JSON.stringify({ budget, activeDays:['Ma','Do'], recipeByDay:{ Ma:'pasta', Do:'tikka' } })
    const restored = restorePlannerPreferencesWithCustomBudget(raw, m2InitialPlan, recipeIds)
    assert.equal(restored.budget, budget)
    assert.deepEqual(restored.activeDays, ['Ma','Do'])
    assert.equal(restored.recipeByDay.Ma, 'pasta')
    assert.equal(restored.recipeByDay.Do, 'tikka')
  }
})
test('product #1424: invalid persisted numbers fall back without trusting extra values', () => {
  for (const budget of [0, -1, 27.501, 1000.01, 1e25, '27,50', null, true, [], {}]) {
    const raw = JSON.stringify({ budget, activeDays:['Di'] })
    assert.equal(restorePlannerPreferencesWithCustomBudget(raw,m2InitialPlan,recipeIds).budget,35)
  }
  assert.deepEqual(
    restorePlannerPreferencesWithCustomBudget('{',m2InitialPlan,recipeIds),
    restorePlannerPreferencesWithCustomBudget(null,m2InitialPlan,recipeIds),
  )
  assert.equal(validCustomWeekBudgetEuros(27.501), null)
  assert.equal(validCustomWeekBudgetEuros(27.5), 27.5)
})
test('product #1424: original explicit-list caller contract is not loosened', () => {
  const raw = JSON.stringify({ budget:27.5, activeDays:['Ma'] })
  assert.equal(parsePlannerPreferences(raw,m2InitialPlan,recipeIds).budget,35)
  assert.equal(restorePlannerPreferencesWithCustomBudget(raw,m2InitialPlan,recipeIds).budget,27.5)
})
