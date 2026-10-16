import assert from 'node:assert/strict'
import test from 'node:test'
import { formatShareableWeek } from '../src/features/planner/weekPlanShare.ts'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'

const original = () => ({
  plannedMeals: m2InitialPlan.map(meal => ({ ...meal })),
  activeDays: ['Ma', 'Di', 'Wo', 'Do'],
  recipes: m2Recipes.map(recipe => ({ ...recipe })),
  budget: 35,
})

function dayLines(text) {
  return text.split('\n').filter(line => /^(Ma|Di|Wo|Do|Vr|Za|Zo): /.test(line))
}

test('private week export stays in Monday-through-Sunday order after restored planner state is reordered', () => {
  const input = original()
  const reversed = [...input.plannedMeals].reverse()
  const before = structuredClone(reversed)
  const expected = ['Ma:', 'Di:', 'Wo:', 'Do:']
  for (const plannedMeals of [reversed, [reversed[1], reversed[3], reversed[0], reversed[2]]]) {
    const text = formatShareableWeek({ ...input, plannedMeals })
    assert.deepEqual(dayLines(text).map(line => line.slice(0, 3)), expected)
    assert.doesNotMatch(text, /Weekbudget|€|bespaard/)
    assert.match(text, /geen prijsopgave/)
  }
  assert.deepEqual(reversed, before, 'sorting never rewrites persisted planned meals')
})

test('week export calendar order is independent of active-day toggling order and recipe listing', () => {
  const input = original()
  const text = formatShareableWeek({
    ...input,
    plannedMeals: [...input.plannedMeals].reverse(),
    activeDays: ['Do', 'Ma', 'Wo'],
    recipes: [...input.recipes].reverse(),
    includeDetails: true,
  })
  assert.deepEqual(dayLines(text).map(line => line.slice(0, 3)), ['Ma:', 'Wo:', 'Do:'])
  assert.match(text, /Ma: Tikka-bowl met kip · 25 min · 2 porties/)
  assert.doesNotMatch(text, /\nDi:/)
})

test('custom safe day labels remain supported and stable without accidental holiday sorting', () => {
  const input = original()
  const text = formatShareableWeek({
    ...input,
    activeDays: ['Vrijdag avond', 'Studiedag'],
    plannedMeals: [
      { day: 'Studiedag', recipeId: 'pasta' },
      { day: 'Vrijdag avond', recipeId: 'tikka' },
    ],
  })
  assert.ok(text.indexOf('Studiedag:') < text.indexOf('Vrijdag avond:'))
  assert.doesNotMatch(text, /€|bespaard/)
})

test('cannot invent an additional weekday when a calendar day is missing from the planned active week', () => {
  const input = original()
  assert.throws(() => formatShareableWeek({
    ...input,
    activeDays: ['Ma', 'Di', 'Wo', 'Vr'],
  }), { message: 'Weekmenu niet beschikbaar' })
})
