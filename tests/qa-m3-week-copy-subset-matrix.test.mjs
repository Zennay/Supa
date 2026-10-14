import assert from 'node:assert/strict'
import test from 'node:test'

import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import { formatShareableWeek } from '../src/features/planner/weekPlanShare.ts'

// Exhaustive 4-day M2 fixture composition: 16 subsets × 4 private opt-in states.
// This is only a fictional local planner state, not a retailer observation.
test('independent: every selected-week subset exports exactly its canonical selected meals', () => {
  const originals = m2InitialPlan.map(({ day, recipeId }) => ({ day, recipeId }))
  const recipesById = new Map(m2Recipes.map((recipe) => [recipe.id, recipe]))
  assert.equal(originals.length, 4, 'explicit fixture expectation protects oracle scope')

  for (let mask = 0; mask < 1 << originals.length; mask += 1) {
    const days = originals.filter((_, i) => (mask & (1 << i)) !== 0).map(({ day }) => day)
    const input = {
      plannedMeals: originals.map((meal) => ({ ...meal })),
      activeDays: [...days].reverse(), // deliberately not canonical order
      recipes: m2Recipes.map((recipe) => ({ ...recipe })),
      budget: 35.25,
    }
    const savedBefore = structuredClone(input)

    for (const includeBudget of [false, true]) {
      for (const includeDetails of [false, true]) {
        const expected = originals
          .filter(({ day }) => days.includes(day))
          .map(({ day, recipeId }) => {
            const recipe = recipesById.get(recipeId)
            assert.ok(recipe, 'source fixture should provide referenced recipe')
            return `${day}: ${recipe.title}` +
              (includeDetails ? ` · ${recipe.minutes} min · ${recipe.servings} porties` : '')
          })

        const copied = formatShareableWeek({ ...input, includeBudget, includeDetails })
        const lines = copied.split('\n')
        const headerLines = lines.filter((line) => line.startsWith('Weekbudget'))
        const selectedLines = lines.filter((line) => originals.some(({ day }) => line.startsWith(`${day}: `)))
        const context = `mask ${mask}, budget=${includeBudget}, details=${includeDetails}`
        assert.deepEqual(selectedLines, expected, `${context}: must only export selected canonical meals`)
        assert.equal(headerLines.length, includeBudget ? 1 : 0, `${context}: budget opt-in required`)
        if (includeBudget) {
          assert.match(headerLines[0], /€\s*35,25/)
        } else {
          assert.doesNotMatch(copied, /€|weekbudget/i)
        }
        if (!includeDetails) assert.doesNotMatch(copied, /\d+ min · \d+ porties/)
        else assert.equal(
          selectedLines.filter((line) => / · \d+ min · \d+ porties$/.test(line)).length,
          expected.length,
          `${context}: each selected recipe has serving details`,
        )
        assert.equal(lines.includes('Geen maaltijden geselecteerd.'), days.length === 0)
        assert.match(copied, /Dit is een planning, geen prijsopgave\./)
        assert.doesNotMatch(copied, /besparing|bespaard|6,40|5,80|4,90/i)
      }
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

test('independent: optional details reject invalid selected recipe metrics but do not expose inactive recipe metadata', () => {
  const originals = m2InitialPlan.map((meal) => ({ ...meal }))
  const recipes = m2Recipes.map((recipe) => ({ ...recipe }))
  const selectedId = originals[0].recipeId
  const inactiveId = originals.find((meal) => meal.recipeId !== selectedId)?.recipeId
  assert.ok(inactiveId)
  const cases = [
    { minutes: NaN }, { minutes: 0 }, { minutes: -1 }, { minutes: 1.5 },
    { minutes: 1441 }, { minutes: 2 ** 53 },
    { servings: NaN }, { servings: 0 }, { servings: -1 }, { servings: 0.5 },
    { servings: 101 }, { servings: 2 ** 53 },
  ]
  for (const mutation of cases) {
    const selected = recipes.map((recipe) =>
      recipe.id === selectedId ? { ...recipe, ...mutation } : recipe)
    const input = { plannedMeals: originals, activeDays: [originals[0].day], recipes: selected, budget: 35 }
    assert.throws(() => formatShareableWeek({ ...input, includeDetails: true }),
      { message: 'Weekmenu niet beschikbaar' }, 'selected invalid metrics must fail closed')
    assert.match(formatShareableWeek(input), /Ma: /, 'default share must not need serving metadata')

    const inactive = recipes.map((recipe) =>
      recipe.id === inactiveId ? { ...recipe, ...mutation } : recipe)
    const inactiveText = formatShareableWeek({ ...input, recipes: inactive, includeDetails: true })
    assert.match(inactiveText, /Ma: /, 'inactive recipe metrics must not affect chosen recipe')
    assert.doesNotMatch(inactiveText, /undefined|NaN|Infinity/)
  }
  assert.throws(() => formatShareableWeek({
    plannedMeals: originals, activeDays: [originals[0].day],
    recipes, budget: 35, includeDetails: 'yes',
  }), { message: 'Weekmenu niet beschikbaar' })
})
