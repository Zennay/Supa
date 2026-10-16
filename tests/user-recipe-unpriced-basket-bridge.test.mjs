import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareUnpricedPrivateRecipe } from '../src/features/user-recipes/reviewedRecipeBasketBridge.ts'
import { aggregatePlanIngredients, buildOneStoreBasket } from '../src/domain/basket.ts'

function reviewedDraft(overrides = {}) {
  return {
    source: 'manual', sourceUrl: null, title: 'Rijst met broccoli',
    servings: 2, minutes: 20, steps: ['Kook de rijst'],
    warnings: [], status: 'needs_review',
    ingredients: [
      { clientId: 'one', original: '150g rijst', label: 'Basmati rijst', query: 'basmati rijst', amount: 150, unit: 'g', reviewReason: null },
      { clientId: 'two', original: '200g broccoli', label: 'Broccoli', query: 'broccoli', amount: 200, unit: 'g', reviewReason: null },
    ], ...overrides,
  }
}

test('reviewed private draft stays unpriced and namespaced', () => {
  const result = prepareUnpricedPrivateRecipe(reviewedDraft(), 'local-1')
  assert.equal(result.status, 'unpriced_ready')
  assert.equal(result.recipe.id, 'private-recipe:local-1')
  assert.equal(result.recipe.priceStatus, 'unknown')
  assert.equal(result.recipe.estimatedCost, null)
  assert.equal(result.recipe.ingredients[0].amount, 150)
  assert.equal(result.recipe.ingredients[0].unit, 'g')
})

test('frozen input is never mutated and no source steps or URL escape', () => {
  const original = reviewedDraft()
  for (const row of original.ingredients) Object.freeze(row)
  Object.freeze(original.ingredients)
  Object.freeze(original.steps)
  Object.freeze(original.warnings)
  Object.freeze(original)
  const result = prepareUnpricedPrivateRecipe(original, 'immutable')
  assert.equal(result.status, 'unpriced_ready')
  assert.ok(!('steps' in result.recipe))
  assert.ok(!('sourceUrl' in result.recipe))
  assert.notEqual(result.recipe.ingredients, original.ingredients)
})

test('same private metric ingredients aggregate through actual core engine', () => {
  const first = prepareUnpricedPrivateRecipe(reviewedDraft(), 'one')
  const second = prepareUnpricedPrivateRecipe(reviewedDraft(), 'two')
  assert.equal(first.status, 'unpriced_ready')
  assert.equal(second.status, 'unpriced_ready')
  // Fixture-only 5-euro shim is NOT emitted by the production bridge.
  const recipes = [first.recipe, second.recipe].map((recipe) => ({ ...recipe, estimatedCost: 5 }))
  const lines = aggregatePlanIngredients(
    [{day:'Ma',recipeId:'private-recipe:one'}, {day:'Di',recipeId:'private-recipe:two'}],
    recipes, ['Ma','Di'])
  assert.equal(lines.length, 2)
  assert.equal(lines.find((x) => x.query === 'basmati rijst').amount, 300)
  assert.equal(lines.find((x) => x.query === 'broccoli').amount, 400)
})

test('offline basket with no prices stays unresolved, never suggests savings', () => {
  const decision = prepareUnpricedPrivateRecipe(reviewedDraft(), 'unpriced')
  assert.equal(decision.status, 'unpriced_ready')
  const basket = buildOneStoreBasket({
    store:{ id:'offline-demo',name:'Offline demo' },
    plan:[{day:'Ma',recipeId:decision.recipe.id}],
    recipes:[{...decision.recipe,estimatedCost:5}], // fixture-only shim
    activeDays:['Ma'], products:[],
  })
  assert.equal(basket.matchedLineCount, 0)
  assert.equal(basket.unresolvedLineCount, 2)
  assert.ok(basket.lines.every((x) => x.status === 'unresolved'))
})

test('unknown quantities cannot become free or be projected', () => {
  const draft = reviewedDraft()
  draft.ingredients[0].amount = null
  draft.ingredients[0].reviewReason = 'Hoeveelheid onbekend'
  const result = prepareUnpricedPrivateRecipe(draft, 'unknown')
  assert.equal(result.status, 'review_required')
  assert.ok(result.reasons.includes('draft_not_reviewed'))
})

test('URL imported drafts require separate trusted fetch and human review', () => {
  const result = prepareUnpricedPrivateRecipe(reviewedDraft({source:'url',sourceUrl:'https://example.org/recipe'}), 'imported')
  assert.equal(result.status, 'review_required')
  assert.ok(result.reasons.includes('source_requires_separate_import_review'))
})

test('unresolved provenance warnings are not removed by the bridge', () => {
  const result = prepareUnpricedPrivateRecipe(reviewedDraft({warnings:['Controleer bron']}), 'warn')
  assert.equal(result.status, 'review_required')
  assert.ok(result.reasons.includes('outstanding_recipe_warnings'))
})

test('unknown preparation time never becomes invented minutes', () => {
  const result = prepareUnpricedPrivateRecipe(reviewedDraft({minutes:null}), 'time')
  assert.equal(result.status, 'review_required')
  assert.ok(result.reasons.includes('missing_or_invalid_preparation_time'))
})

test('unsafe IDs and existing recipe identity collisions refuse projection', () => {
  assert.equal(prepareUnpricedPrivateRecipe(reviewedDraft(),'../../other').status, 'review_required')
  const duplicate = prepareUnpricedPrivateRecipe(reviewedDraft(),'one',['private-recipe:one'])
  assert.equal(duplicate.status, 'review_required')
  assert.ok(duplicate.reasons.includes('duplicate_or_invalid_recipe_id'))
})

test('invalid normalized query never reaches product matching', () => {
  const draft = reviewedDraft()
  draft.ingredients[0].query = 'rijst' + String.fromCharCode(0) + 'secret'
  const result = prepareUnpricedPrivateRecipe(draft,'bad-query')
  assert.equal(result.status, 'review_required')
  assert.ok(result.reasons.includes('invalid_ingredient_query'))
})

test('gram/piece identities stay separate to avoid quantity drift', () => {
  const draft = reviewedDraft()
  draft.ingredients[1] = {...draft.ingredients[1], query:'basmati rijst',label:'Basmati rijst',unit:'piece',amount:1}
  const result = prepareUnpricedPrivateRecipe(draft,'different-units')
  assert.equal(result.status, 'unpriced_ready')
  assert.notEqual(result.recipe.ingredients[0].id, result.recipe.ingredients[1].id)
})

test('importer metric ceiling remains enforced despite permissive editor', () => {
  const draft = reviewedDraft()
  draft.ingredients[0].amount = 1_000_001
  const out = prepareUnpricedPrivateRecipe(draft, 'oversize')
  assert.equal(out.status, 'review_required')
  assert.ok(out.reasons.includes('metric_amount_exceeds_import_contract'))
  draft.ingredients[0].amount = 1_000_000
  assert.equal(prepareUnpricedPrivateRecipe(draft, 'limit').status, 'unpriced_ready')
})
