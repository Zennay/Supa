/**
 * Independent SUPA QA on frozen product-owned unpriced basket bridge #3291
 * SHA 09f93aec37784a373430d03ed98e21609fc834f8.
 *
 * Existing portion scaler explicitly marks any fractional "piece" for human
 * review. The unpriced basket bridge must not silently bypass this rule.
 * Synthetic local data only, no retailer catalog, pricing, fetch or storage.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareUnpricedPrivateRecipe } from
  '../src/features/user-recipes/reviewedRecipeBasketBridge.ts'
import { scaleMetricRecipeDraft } from
  '../src/domain/userRecipePortions.ts'

function reviewDraft(amount, unit = 'piece') {
  return {
    source: 'manual', sourceUrl: null,
    title: 'Fictieve groentesoep', servings: 2, minutes: 20,
    warnings: [], steps: ['Bereid dit fictieve gerecht'],
    status: 'needs_review',
    ingredients: [{
      clientId: 'local-row-1', original: '2 uien',
      label: 'Ui', query: 'ui',
      amount, unit, reviewReason: null,
    }],
  }
}
test('positive: integral piece quantities can produce unpriced draft, never fake price', () => {
  const draft = reviewDraft(2)
  const result = prepareUnpricedPrivateRecipe(draft, 'integer-onion')
  assert.equal(result.status, 'unpriced_ready')
  assert.equal(result.recipe.ingredients[0].amount, 2)
  assert.equal(result.recipe.ingredients[0].unit, 'piece')
  assert.equal(result.recipe.estimatedCost, null)
  assert.equal(result.recipe.priceStatus, 'unknown')
  assert.equal(result.recipe.provenance, 'local_manual_review')
})
test('positive: legitimate fractional grams remain supported, unlike physical pieces', () => {
  const draft = reviewDraft(1.5, 'g')
  const result = prepareUnpricedPrivateRecipe(draft, 'fractional-grams')
  assert.equal(result.status, 'unpriced_ready')
  assert.equal(result.recipe.ingredients[0].amount, 1.5)
  assert.equal(result.recipe.ingredients[0].unit, 'g')
})

for (const amount of [1.5, 0.333, 2.25]) {
  test('unpriced basket must not treat unreviewed ' + amount + ' pieces as ready [EXPECTED RED]', () => {
    const draft = reviewDraft(amount)
    const upstream = scaleMetricRecipeDraft(draft, draft.servings)
    assert.equal(upstream.status, 'needs_review',
      'upstream canonical scaler already requires explicit human fractional-piece review')
    assert.ok(upstream.warnings.some(w => w.code === 'fractional_piece'))
    const result = prepareUnpricedPrivateRecipe(draft, 'fractional-piece')
    assert.equal(result.status, 'review_required',
      'basket preparation must not silently remove fractional-piece review gate')
    assert.ok(result.reasons.some(reason => /piece|fractional|stuk|hoeveelheid|review/.test(reason)),
      'human-readable or machine-readable review reason is required')
  })
}
