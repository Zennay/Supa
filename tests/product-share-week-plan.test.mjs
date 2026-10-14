import assert from 'node:assert/strict'
import test from 'node:test'

import { formatShareableWeek } from '../src/features/planner/weekPlanShare.ts'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'

const input = () => ({
  plannedMeals: m2InitialPlan.map((meal) => ({ ...meal })),
  activeDays: ['Ma', 'Wo'],
  recipes: m2Recipes.map((recipe) => ({ ...recipe })),
  budget: 35,
})

test('copies only active meals in canonical day order, not persisted toggle order', () => {
  const data = input()
  data.activeDays = ['Wo', 'Ma']
  const before = structuredClone(data)
  const result = formatShareableWeek(data)
  assert.match(result, /^SUPA · Weekmenu\nWeekbudget \(eigen voorkeur\): €35,00/m)
  assert.ok(result.indexOf('Ma: ') < result.indexOf('Wo: '))
  assert.doesNotMatch(result, /\nDi: |\nDo: /)
  assert.match(result, /geen prijsopgave/i)
  assert.match(result, /echte winkelprijzen zijn niet inbegrepen/i)
  assert.deepEqual(data, before, 'copy must never mutate the live planner state')
})

test('empty planned week is explicitly empty rather than claiming recipes', () => {
  const text = formatShareableWeek({ ...input(), activeDays: [] })
  assert.match(text, /Geen maaltijden geselecteerd/)
  assert.doesNotMatch(text, /\nMa: |\nDi: |\nWo: |\nDo: /)
})

test('invalid recipe estimates are never exported as plausible supermarket prices', () => {
  const data = input()
  data.recipes[0].estimatedCost = Number.NaN
  const text = formatShareableWeek(data)
  assert.doesNotMatch(text, /NaN|\/ recept|Richtprijs|bespaard/i)
  assert.match(text, /geen prijsopgave/i)
})

test('stale or ambiguous current active meal identity fails closed without leaking labels', () => {
  const base = input()
  const cases = [
    { ...base, activeDays: ['Vr'] },
    { ...base, activeDays: ['Ma', 'Ma'] },
    { ...base, plannedMeals: [{ day: 'Ma', recipeId: 'missing' }], activeDays: ['Ma'] },
    { ...base, plannedMeals: [...base.plannedMeals, { day: 'Ma', recipeId: 'tikka' }] },
    { ...base, recipes: [...base.recipes, base.recipes[0]] },
    { ...base, plannedMeals: [{ day: 'Ma\nFake: ', recipeId: 'tikka' }], activeDays: ['Ma\nFake: '] },
    { ...base, budget: -5 },
    { ...base, budget: Number.NaN },
    { ...base, budget: 1e25 },
    { ...base, activeDays: Array(15).fill('Ma') },
  ]
  for (const entry of cases) {
    assert.throws(() => formatShareableWeek(entry), /Weekmenu niet beschikbaar|Ongeldig|onjuist/i)
  }
})

test('malformed or control-character recipe titles cannot spoof exported plan lines', () => {
  const base = input()
  const recipe = base.recipes.find((candidate) => candidate.id === 'tikka')
  assert.ok(recipe)
  for (const title of ['Onveilig\nVrijdag: verrassingsgerecht', ' \t ', 'Onveilig\u202eprijs']) {
    const mutated = {
      ...base,
      recipes: base.recipes.map((entry) => entry.id === recipe.id ? { ...entry, title } : entry),
    }
    assert.throws(() => formatShareableWeek(mutated), /Weekmenu niet beschikbaar/)
  }
})
