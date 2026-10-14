import assert from 'node:assert/strict'
import test from 'node:test'
import { formatShareableWeek } from '../src/features/planner/weekPlanShare.ts'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'

// Independent product-core reproduction of the reported Dutch singular boundary
// from #2362, using fictional recipe metadata only.
test('one-serving share detail uses 1 portie; all other counts use porties', () => {
  const first = m2InitialPlan[0]
  assert.ok(first, 'fixture must contain a selected meal')
  const chosenRecipe = m2Recipes.find(recipe => recipe.id === first.recipeId)
  assert.ok(chosenRecipe, 'the selected recipe must exist in the fixture')
  const fixture = servings => ({
    plannedMeals: [first],
    activeDays: [first.day],
    recipes: [{ ...chosenRecipe, servings }],
    budget: 35,
    includeBudget: false,
    includeDetails: true,
  })
  for (const count of [1, 2, 3, 100]) {
    const output = formatShareableWeek(fixture(count))
    assert.match(output, new RegExp(` · ${count} portie${count === 1 ? '' : 's'}(?:\\n|$)`))
    assert.doesNotMatch(output, /1 porties|echte winkelprijs:|bespaard:/i)
    assert.doesNotMatch(output, /Weekbudget|€/,
      'opt-in display of recipe details cannot enable budget sharing')
  }
  for (const invalid of [0, -1, 1.1, 101]) {
    assert.throws(() => formatShareableWeek(fixture(invalid)), /Weekmenu niet beschikbaar/)
  }
  const defaultPrivateText = formatShareableWeek({
    ...fixture(1), includeDetails: false,
  })
  assert.doesNotMatch(defaultPrivateText, /portie| min /)
  assert.match(defaultPrivateText, /geen prijsopgave/i)
})
