import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts, m3BaselineStore,
  m3CandidateProducts, m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

const recipeIds = m2Recipes.map((recipe) => recipe.id)
function planFor(index) {
  let value = index
  return m2InitialPlan.map(({ day }) => {
    const recipeId = recipeIds[value % recipeIds.length]
    value = Math.floor(value / recipeIds.length)
    return { day, recipeId }
  })
}
function build(store, products, plan, recipes = m2Recipes) {
  return buildOneStoreBasket({
    store, products, plan, recipes, activeDays: m2DefaultActiveDays,
  })
}
function modifyOneIngredient(recipes, chosenRecipe, change) {
  return recipes.map((recipe) => recipe.id === chosenRecipe
    ? { ...recipe, ingredients: recipe.ingredients.map((ingredient, i) =>
        i === 0 ? change(ingredient) : { ...ingredient },
      ) }
    : recipe)
}
function assertUnclaimable(result, context, matcher) {
  assert.equal(result.claimable, false, context)
  assert.equal(result.outcome, 'unknown', context)
  assert.equal(result.deltaCents, null, context)
  assert.equal(result.savingsCents, null, context)
  assert.deepEqual(result.lineDeltas, [], context)
  assert.match(result.reasons.join(' '), matcher, context)
}

test('81 same-priced weeks abstain when one ingredient amount changes without changing pack count', () => {
  for (let index = 0; index < recipeIds.length ** m2DefaultActiveDays.length; index += 1) {
    const plan = planFor(index)
    const baseline = build(m3BaselineStore, m3BaselineProducts, plan)
    const normal = build(m3CandidateStore, m3CandidateProducts, plan)
    assert.equal(normal.unresolvedLineCount, 0)
    assert.equal(compareFullBaskets({ baseline, candidate: normal }).claimable, true)
    const recipeId = plan[0].recipeId
    const changedRecipes = modifyOneIngredient(m2Recipes, recipeId, (ingredient) => ({
      ...ingredient, amount: ingredient.amount - 0.001,
    }))
    const modified = build(m3CandidateStore, m3CandidateProducts, plan, changedRecipes)
    assert.equal(modified.unresolvedLineCount, 0, `week ${index}`)
    const originalIds = normal.lines.map(({ id }) => id).sort()
    const modifiedIds = modified.lines.map(({ id }) => id).sort()
    assert.deepEqual(modifiedIds, originalIds, `week ${index}: same ingredient coverage`)
    assert.equal(modified.totalCents, normal.totalCents, `week ${index}: same basket money`)

    assertUnclaimable(
      compareFullBaskets({ baseline, candidate: modified }),
      `week ${index}: distinct ingredient demand cannot be priced as same-demand`,
      /ingredient demand differs/,
    )
  }
})

test('81 same-price weeks abstain when a trusted ingredient label changes across stores', () => {
  for (let index = 0; index < recipeIds.length ** m2DefaultActiveDays.length; index += 1) {
    const plan = planFor(index)
    const baseline = build(m3BaselineStore, m3BaselineProducts, plan)
    const normal = build(m3CandidateStore, m3CandidateProducts, plan)
    const changedIngredientId = m2Recipes.find((recipe) => recipe.id === plan[0].recipeId).ingredients[0].id
    const changedRecipes = m2Recipes.map((recipe) => ({
      ...recipe,
      ingredients: recipe.ingredients.map((ingredient) => ingredient.id === changedIngredientId
        ? { ...ingredient, label: `${ingredient.label} (andere productbetekenis)` }
        : { ...ingredient }),
    }))
    const changed = build(m3CandidateStore, m3CandidateProducts, plan, changedRecipes)
    assert.equal(changed.unresolvedLineCount, 0)
    assert.equal(changed.totalCents, normal.totalCents)
    assertUnclaimable(
      compareFullBaskets({ baseline, candidate: changed }),
      `week ${index}: same id but different ingredient semantics`,
      /ingredient label differs/,
    )
  }
})
