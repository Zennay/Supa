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
  data.includeBudget = true
  const before = structuredClone(data)
  const result = formatShareableWeek(data)
  assert.match(result, /^SUPA · Weekmenu\nWeekbudget \(eigen voorkeur\): €\s*35,00/m)
  assert.ok(result.indexOf('Ma: ') < result.indexOf('Wo: '))
  assert.doesNotMatch(result, /\nDi: |\nDo: /)
  assert.match(result, /geen prijsopgave/i)
  assert.match(result, /echte winkelprijzen zijn niet inbegrepen/i)
  assert.deepEqual(data, before, 'copy must never mutate the live planner state')
})

test('private share omits personal weekbudget until the user explicitly opts in', () => {
  const data = input()
  assert.doesNotMatch(formatShareableWeek(data), /Weekbudget|€/)
  assert.match(formatShareableWeek({ ...data, includeBudget: true }), /Weekbudget.*35,00/)
  assert.throws(() => formatShareableWeek({ ...data, includeBudget: 'yes' }), /Weekmenu niet beschikbaar/)
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

test('M3 copied menu rejects Unicode paragraph, line and zero-width format injection (#2360)', () => {
  for (const injected of [
    'Tikka\u2028Vr: Nepmenu',
    'Tikka\u2029Vr: Nepmenu',
    'Tikka\u200bextra',
    'Tikka\u200crecept',
    'Tikka\u200dextra',
    'Tikka\u2060extra',
    'Tikka\ufeffextra',
    '\u200b',
    '\u200c',
    '\u200d',
    '\u2060',
  ]) {
    const base = input()
    const malformedTitle = {
      ...base,
      recipes: base.recipes.map((entry) =>
        entry.id === 'tikka' ? { ...entry, title: injected } : entry),
    }
    assert.throws(
      () => formatShareableWeek(malformedTitle),
      { message: 'Weekmenu niet beschikbaar' },
    )
    const malformedDay = {
      ...base,
      activeDays: [injected],
      plannedMeals: [{ day: injected, recipeId: 'tikka' }],
    }
    assert.throws(
      () => formatShareableWeek(malformedDay),
      { message: 'Weekmenu niet beschikbaar' },
    )
    const malformedId = {
      ...base,
      plannedMeals: [{ day: 'Ma', recipeId: injected }],
      activeDays: ['Ma'],
      recipes: [{ ...base.recipes[0], id: injected }],
    }
    assert.throws(
      () => formatShareableWeek(malformedId),
      { message: 'Weekmenu niet beschikbaar' },
    )
  }
})

test('M3 copied menu preserves readable Dutch names, accents and honest optional budget', () => {
  const base = input()
  const edited = {
    ...base,
    recipes: base.recipes.map((entry) =>
      entry.id === 'tikka' ? { ...entry, title: 'Crème brûlée met peren' } : entry),
    includeBudget: true,
    budget: 35.25,
  }
  const result = formatShareableWeek(edited)
  assert.match(result, /Ma: Crème brûlée met peren/)
  assert.match(result, /Weekbudget \\(eigen voorkeur\\): €\\s*35,25/)
  assert.match(result, /Dit is een planning, geen prijsopgave/)
  assert.doesNotMatch(result, /bespaard|echte prijzen:/)
})
