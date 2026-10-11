import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultPlannerPreferences,
  parsePlannerPreferences,
  serializePlannerPreferences,
} from '../src/domain/plannerPreferences.ts'

const plan = [{ day: 'Ma', recipeId: 'meal' }, { day: 'Di', recipeId: 'meal' }]
const recipeIds = ['meal']

test('explicit caller budgets reject fractional-cent and unsafe amounts', () => {
  for (const invalid of [35.005, 0.001, Number.MAX_VALUE, Infinity, NaN, -1, 0, '35']) {
    const persisted = serializePlannerPreferences({
      budget: invalid, activeDays: ['Di'], recipeByDay: { Ma: 'meal', Di: 'meal' },
    })
    const result = parsePlannerPreferences(persisted, plan, recipeIds, 35, [invalid, 35, 40])
    assert.equal(result.budget, 35, String(invalid))
    assert.deepEqual(result.activeDays, ['Di'])
    assert.deepEqual(result.recipeByDay, { Ma: 'meal', Di: 'meal' })
  }
})

test('supported cent-exact budgets survive persistence without changing the week', () => {
  for (const budget of [0.01, 0.29, 27.5, 35, 42.75, 1000]) {
    const result = parsePlannerPreferences(
      JSON.stringify({ budget, activeDays: ['Di'], recipeByDay: { Di: 'meal' } }),
      plan, recipeIds, 35, [35, budget],
    )
    assert.equal(result.budget, budget)
    assert.deepEqual(result.activeDays, ['Di'])
  }
})

test('invalid direct default budget values fall back to 35 euros', () => {
  for (const invalid of [35.005, 0.001, Number.MAX_VALUE, Infinity, NaN, -1, 0]) {
    assert.equal(defaultPlannerPreferences(plan, invalid).budget, 35, String(invalid))
  }
})

test('invalid caller budget lists cannot launder an invalid persisted budget', () => {
  const result = parsePlannerPreferences(
    JSON.stringify({ budget: 35.005, activeDays: [] }),
    plan, recipeIds, 35.005, [35.005, 0.001, Number.MAX_VALUE],
  )
  assert.equal(result.budget, 35)
  assert.deepEqual(result.activeDays, [])
})
