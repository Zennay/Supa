import assert from 'node:assert/strict'
import test from 'node:test'

import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import { formatShareableWeek } from '../src/features/planner/weekPlanShare.ts'

// Exhaustive 4-day M2 fixture composition: 16 possible chosen-day subsets.
// This is only a fictional local planner state, not a retailer observation.
test('independent: every selected-week subset exports exactly its canonical selected meals', () => {
  const originals = m2InitialPlan.map(({ day, recipeId }) => ({ day, recipeId }))
  const titles = new Map(m2Recipes.map(({ id, title }) => [id, title]))
  assert.equal(originals.length, 4, 'explicit fixture expectation protects oracle scope')

  for (let mask = 0; mask < 1 << originals.length; mask += 1) {
    const days = originals.filter((_, i) => (mask & (1 << i)) !== 0).map(({ day }) => day)
    const expected = originals
      .filter(({ day }) => days.includes(day))
      .map(({ day, recipeId }) => `${day}: ${titles.get(recipeId)}`)
    const input = {
      plannedMeals: originals.map((meal) => ({ ...meal })),
      activeDays: [...days].reverse(), // deliberately not canonical order
      recipes: m2Recipes.map((recipe) => ({ ...recipe })),
      budget: 35.25,
    }
    const savedBefore = structuredClone(input)

    for (const includeBudget of [false, true]) {
      const copied = formatShareableWeek({ ...input, includeBudget })
      const lines = copied.split('\n')
      const headerLines = lines.filter((line) => line.startsWith('Weekbudget'))
      const selectedLines = lines.filter((line) => originals.some(({ day }) => line.startsWith(`${day}: `)))
      assert.deepEqual(
        selectedLines, expected,
        `mask ${mask} must not insert/reorder/remove selected days`,
      )
      assert.equal(
        headerLines.length, includeBudget ? 1 : 0,
        `mask ${mask}: private budget must require explicit opt-in`,
      )
      if (includeBudget) {
        assert.match(headerLines[0], /€\s*35,25/)
      } else {
        assert.doesNotMatch(copied, /€|weekbudget/i)
      }

      if (days.length === 0) {
        assert.match(copied, /Geen maaltijden geselecteerd\./)
      } else {
        assert.doesNotMatch(copied, /Geen maaltijden geselecteerd\./)
      }
      assert.match(copied, /Dit is een planning, geen prijsopgave\./)
      assert.doesNotMatch(copied, /besparing|bespaard|6,40|5,80|4,90/i)
    }
    assert.deepEqual(input, savedBefore, `mask ${mask} must not mutate live planner state`)
  }
})

test('independent: stale activity selections never silently copy a recipe from the wrong day', () => {
  const original = m2InitialPlan.map((meal) => ({ ...meal }))
  for (const activeDays of [
    ['Vr'],
    ['Ma', 'Vr'],
    ['Ma', 'Ma'],
  ]) {
    assert.throws(
      () => formatShareableWeek({
        plannedMeals: original,
        activeDays,
        recipes: m2Recipes,
        budget: 35.25,
      }),
      { message: 'Weekmenu niet beschikbaar' },
    )
  }
})
