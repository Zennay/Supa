import assert from 'node:assert/strict'
import test from 'node:test'

import { formatShareableWeek } from '../src/features/planner/weekPlanShare.ts'

// All identifiers and prices below are fictional. This is a pure in-memory
// formatter contract; NOT supermarket evidence or a user/field observation.
const meal = () => ({
  plannedMeals: [
    { day: 'Ma', recipeId: 'tikka' },
    { day: 'Wo', recipeId: 'pasta' },
  ],
  activeDays: ['Ma', 'Wo'],
  recipes: [
    { id: 'tikka', title: 'Tikka met kip', estimatedCost: 6000 },
    { id: 'pasta', title: 'Romige pasta', estimatedCost: Number.NaN },
  ],
  budget: 34.25,
})

test('independent: week text includes only selected meals and preference, not fake financial evidence', () => {
  const source = meal()
  const before = structuredClone(source)
  const text = formatShareableWeek(source)
  assert.match(text, /^SUPA · Weekmenu\n\nMa: Tikka met kip\nWo: Romige pasta\n/)
  assert.doesNotMatch(text, /Weekbudget|€/, 'personal budget must be private by default')
  const optedIn = formatShareableWeek({ ...source, includeBudget: true })
  assert.match(optedIn, /^SUPA · Weekmenu\nWeekbudget \(eigen voorkeur\): €\s*34,25\n/)
  assert.match(text, /\nMa: Tikka met kip\nWo: Romige pasta\n/)
  assert.match(text, /Dit is een planning, geen prijsopgave\./)
  assert.match(text, /echte winkelprijzen zijn niet inbegrepen/i)
  assert.doesNotMatch(text, /6000|NaN|\nDi:|bespaard|besparing/i)
  assert.deepEqual(source, before, 'sharing must not mutate any planner inputs')
})

test('independent: empty active week stays explicit and never leaks inactive meal names', () => {
  const text = formatShareableWeek({ ...meal(), activeDays: [] })
  assert.match(text, /Geen maaltijden geselecteerd\./)
  assert.doesNotMatch(text, /\nMa:|\nWo:|Tikka met kip|Romige pasta/)
})

test('independent: cent-exact budgets accepted but invented extra decimal precision refused', () => {
  const zero = formatShareableWeek({ ...meal(), budget: 0, includeBudget: true })
  assert.match(zero, /Weekbudget \(eigen voorkeur\): €\s*0,00/)
  assert.throws(() => formatShareableWeek({ ...meal(), includeBudget: 'yes' }), { message: 'Weekmenu niet beschikbaar' })
  for (const budget of [-0.01, 1.001, Number.NaN, Infinity, 1e25]) {
    assert.throws(
      () => formatShareableWeek({ ...meal(), budget }),
      { message: 'Weekmenu niet beschikbaar' },
      `invalid budget ${String(budget)}`,
    )
  }
})

test('independent: missing active recipe and duplicate source identity cannot silently export stale plan', () => {
  const base = meal()
  for (const bad of [
    { ...base, plannedMeals: [{ day: 'Ma', recipeId: 'missing' }], activeDays: ['Ma'] },
    { ...base, plannedMeals: [...base.plannedMeals, base.plannedMeals[0]] },
    { ...base, recipes: [...base.recipes, { ...base.recipes[0] }] },
    { ...base, activeDays: ['Ma', 'Ma'] },
  ]) {
    assert.throws(() => formatShareableWeek(bad), { message: 'Weekmenu niet beschikbaar' })
  }
})

test('independent: ordinary Dutch diacritics remain copyable, while bidi controls stay forbidden', () => {
  const good = meal()
  good.recipes[0].title = 'Crème brûlée met appel'
  assert.match(formatShareableWeek(good), /Crème brûlée met appel/)
  const bad = meal()
  bad.recipes[0].title = 'Onzeker\u202e€100'
  assert.throws(() => formatShareableWeek(bad), { message: 'Weekmenu niet beschikbaar' })
})

test('ORIGINAL EXPECTED RED #2360: Unicode line and paragraph separators cannot inject copied menu lines', () => {
  for (const separator of ['\u2028', '\u2029']) {
    for (const position of ['title', 'day']) {
      const input = meal()
      if (position === 'title') {
        input.recipes[0].title = `Tikka${separator}Vr: Nepmenu`
      } else {
        input.activeDays = [`Ma${separator}Vr: Nepmenu`, 'Wo']
        input.plannedMeals[0].day = input.activeDays[0]
      }
      assert.throws(
        () => formatShareableWeek(input),
        { message: 'Weekmenu niet beschikbaar' },
        `${position} with U+${separator.codePointAt(0).toString(16)} must fail closed`,
      )
    }
  }
})

test('ORIGINAL EXPECTED RED #2360: invisible-only recipe titles and day identities cannot masquerade as visible selections', () => {
  for (const invisible of ['\u200b', '\u200c', '\u200d']) {
    const title = meal()
    title.recipes[0].title = invisible
    assert.throws(
      () => formatShareableWeek(title),
      { message: 'Weekmenu niet beschikbaar' },
      'visually blank recipe title must not be exported',
    )
    const day = meal()
    day.activeDays = [invisible, 'Wo']
    day.plannedMeals[0].day = invisible
    assert.throws(
      () => formatShareableWeek(day),
      { message: 'Weekmenu niet beschikbaar' },
      'visually blank day identity must not be exported',
    )
  }
})
