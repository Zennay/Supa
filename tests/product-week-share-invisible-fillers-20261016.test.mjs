import assert from 'node:assert/strict'
import test from 'node:test'
import { formatShareableWeek } from '../src/features/planner/weekPlanShare.ts'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'

// Synthetic presentation-only labels; no retailer prices or real study data.
const input = () => ({
  plannedMeals: m2InitialPlan.map(meal => ({ ...meal })),
  activeDays: ['Ma'],
  recipes: m2Recipes.map(recipe => ({ ...recipe })),
  budget: 35,
})

test('M3 share refuses invisible Unicode fillers in titles, days and recipe identity', () => {
  for (const filler of ['\\u115f', '\\u1160', '\\u2800', '\\u3164', '\\uffa0']) {
    // Decode the explicit Unicode code-point escape into the actual character.
    const character = JSON.parse('"'+filler+'"')
    const data = input()
    assert.throws(() => formatShareableWeek({
      ...data,
      recipes: data.recipes.map(recipe => recipe.id === 'tikka'
        ? { ...recipe, title: character } : recipe),
    }), { message: 'Weekmenu niet beschikbaar' })
    assert.throws(() => formatShareableWeek({
      ...data,
      recipes: data.recipes.map(recipe => recipe.id === 'tikka'
        ? { ...recipe, title: 'Tikka' + character + 'korting' } : recipe),
    }), { message: 'Weekmenu niet beschikbaar' })
    assert.throws(() => formatShareableWeek({
      ...data,
      activeDays: ['Ma' + character],
      plannedMeals: [{ day: 'Ma' + character, recipeId: 'tikka' }],
    }), { message: 'Weekmenu niet beschikbaar' })
    assert.throws(() => formatShareableWeek({
      ...data,
      plannedMeals: [{ day: 'Ma', recipeId: 'tikka' + character }],
      recipes: [{ ...data.recipes[0], id: 'tikka' + character }],
    }), { message: 'Weekmenu niet beschikbaar' })
  }
})

test('readable accented Dutch recipe sharing remains available without adding prices', () => {
  const data = input()
  const result = formatShareableWeek({
    ...data,
    recipes: data.recipes.map(recipe => recipe.id === 'tikka'
      ? { ...recipe, title: 'Crème brûlée met peren' } : recipe),
  })
  assert.match(result, /Ma: Crème brûlée met peren/)
  assert.match(result, /geen prijsopgave/)
  assert.doesNotMatch(result, /€|bespaard|huidige supermarktprijs/i)
})
