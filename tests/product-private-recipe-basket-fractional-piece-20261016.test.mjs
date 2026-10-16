/** Offline product #3298: fractions of physical pieces need human review. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareUnpricedPrivateRecipe } from
  '../src/features/user-recipes/reviewedRecipeBasketBridge.ts'
import { scaleMetricRecipeDraft } from '../src/domain/userRecipePortions.ts'

function draft(amount, unit) {
  return {
    source: 'manual', sourceUrl: null, title: 'Fictieve salade',
    servings: 2, minutes: 20, warnings: [], steps: ['Fictief koken'],
    status: 'needs_review',
    ingredients: [{
      clientId: 'local-1', original: 'Eenheden',
      label: 'Ui', query: 'ui', amount, unit, reviewReason: null,
    }],
  }
}
for (const amount of [0.001, 0.333, 0.5, 1.5, 2.25, 999_999.5]) {
  test('fractional physical pieces ' + amount + ' stay in human review and never gain a price', () => {
    const source = draft(amount, 'piece')
    const unchanged = structuredClone(source)
    const scaler = scaleMetricRecipeDraft(source, source.servings)
    assert.equal(scaler.status, 'needs_review')
    const result = prepareUnpricedPrivateRecipe(source, 'private-onion')
    assert.equal(result.status, 'review_required')
    assert.ok(result.reasons.includes('fractional_piece_needs_human_review'))
    assert.equal('recipe' in result, false, 'not projected as a priced/ready basket')
    assert.deepEqual(source, unchanged)
  })
}
for (const [amount, unit] of [[1, 'piece'], [2, 'piece'], [1.5, 'g'], [0.333, 'ml']]) {
  test('normal integer pieces or fractional metric amount remain honest unpriced: ' + amount + ' ' + unit, () => {
    const result = prepareUnpricedPrivateRecipe(draft(amount, unit), 'private-onion')
    assert.equal(result.status, 'unpriced_ready')
    assert.equal(result.recipe.estimatedCost, null)
    assert.equal(result.recipe.priceStatus, 'unknown')
    assert.equal(result.recipe.ingredients[0].amount, amount)
    assert.equal(result.recipe.ingredients[0].unit, unit)
  })
}
