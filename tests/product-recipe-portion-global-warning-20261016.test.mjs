/**
 * Product #3293: global human review warnings stay blocking across serving
 * changes, independently of local ingredient quantity/URL string syntax.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyUserRecipeDraft, updateEditorIngredient } from
  '../src/features/user-recipes/userRecipeDraftEditor.ts'
import { previewLocalRecipePortions } from
  '../src/features/user-recipes/recipeDraftFlow.ts'
import { previewPrivateRecipeShoppingNeeds } from
  '../src/features/user-recipes/userRecipeShoppingNeeds.ts'

function prepared() {
  const draft = emptyUserRecipeDraft()
  return updateEditorIngredient(
    { ...draft, title: 'Fictieve soep', servings: 2, warnings: [] },
    0, { label: 'Courgette', amount: 200, unit: 'g' },
  )
}
test('warning-free manual recipe can preview portions without financial claim', () => {
  const source = prepared()
  const before = structuredClone(source)
  const preview = previewLocalRecipePortions(source, 4)
  assert.equal(preview.needsReview, false)
  assert.equal(preview.draft.ingredients[0].amount, 400)
  assert.equal(preview.fetchAuthorized, false)
  assert.equal(preview.cloudSaved, false)
  assert.deepEqual(source, before)
})
for (const sourceType of ['manual', 'url']) {
  for (const warning of [
    'Controleer de oorspronkelijke herkomst',
    'Oplossen: onzekere cups/grams-conversie',
    'Controleer JSON-LD ingrediënten',
  ]) {
    test('source-level warning persists through ' + sourceType + ' portion preview: ' + warning, () => {
      const source = prepared()
      source.source = sourceType
      source.sourceUrl = sourceType === 'url' ? 'https://www.fictional-recipes.nl/soep' : null
      source.warnings = [warning]
      const before = structuredClone(source)
      const preview = previewLocalRecipePortions(source, 4)
      assert.equal(preview.needsReview, true)
      assert.equal(preview.draft.ingredients[0].amount, 400)
      assert.deepEqual(preview.draft.warnings, [warning])
      assert.equal(preview.fetchAuthorized, false)
      assert.equal(preview.cloudSaved, false)
      assert.deepEqual(source, before)
      const shopping = previewPrivateRecipeShoppingNeeds(source, 4)
      assert.equal(shopping.status, 'needs_review')
      assert.equal(shopping.priced, false)
      assert.equal(shopping.retailerComparisonAvailable, false)
    })
  }
}
test('malformed absent global warning collection cannot accidentally certify a preview', () => {
  const source = prepared()
  source.warnings = undefined
  const preview = previewLocalRecipePortions(source, 2)
  assert.equal(preview.needsReview, true)
  assert.equal(preview.fetchAuthorized, false)
})
