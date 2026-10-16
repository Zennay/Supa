/**
 * Independent quality-validation: frozen Supa product composition owner #3285
 * HEAD c94ca4dde4bbb8dabcac870d9538c31dc29ef239.
 * Review warnings from already-imported human/uncertain recipe data must
 * survive previewing new serving sizes, and agree with shopping preview gate.
 * Never imports real URLs, makes requests, or publishes price claims.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyUserRecipeDraft,
  updateEditorIngredient,
} from '../src/features/user-recipes/userRecipeDraftEditor.ts'
import {
  previewLocalRecipePortions,
} from '../src/features/user-recipes/recipeDraftFlow.ts'
import {
  previewPrivateRecipeShoppingNeeds,
} from '../src/features/user-recipes/userRecipeShoppingNeeds.ts'

function sample() {
  const draft = emptyUserRecipeDraft()
  const titled = { ...draft, title: 'Fictieve soep', servings: 2, warnings: [] }
  return updateEditorIngredient(titled, 0, {
    label: 'Courgette', amount: 200, unit: 'g',
  })
}

test('positive: complete manual recipe without warnings needs no extra review', () => {
  const source = sample()
  const original = structuredClone(source)
  const portion = previewLocalRecipePortions(source, 4)
  const shopping = previewPrivateRecipeShoppingNeeds(source, 4)
  assert.equal(portion.needsReview, false)
  assert.equal(portion.draft.ingredients[0].amount, 400)
  assert.equal(shopping.status, 'complete_unpriced')
  assert.equal(portion.fetchAuthorized, false)
  assert.equal(portion.cloudSaved, false)
  assert.equal(shopping.priced, false)
  assert.equal(shopping.retailerComparisonAvailable, false)
  assert.deepEqual(source, original)
})

test('original import-level warning must keep portion review open even with canonical metric fields [EXPECTED RED]', () => {
  const source = sample()
  source.warnings = ['Controleer de oorspronkelijke porties en productherkomst']
  const saved = structuredClone(source)
  const portion = previewLocalRecipePortions(source, 4)
  assert.equal(portion.draft.ingredients[0].amount, 400)
  assert.equal(portion.needsReview, true,
    'global provenance uncertainty cannot disappear solely by changing servings')
  assert.ok(portion.draft.warnings.some(w => /oorspronkelijke/.test(w)))
  assert.equal(portion.fetchAuthorized, false)
  assert.deepEqual(source, saved)
})

test('manual/retailer shopping preview and integrated portion review must agree on unresolved source warning [EXPECTED RED]', () => {
  const source = sample()
  source.warnings = ['Controleer handmatige maatconversie']
  const shopping = previewPrivateRecipeShoppingNeeds(source, 2)
  const portion = previewLocalRecipePortions(source, 2)
  assert.equal(shopping.status, 'needs_review')
  assert.equal(portion.needsReview, true,
    'user must not see contradictory green portion vs blocked shopping preview')
  assert.equal(shopping.priced, false)
  assert.equal(shopping.retailerComparisonAvailable, false)
})

test('accepted HTTPS source URL never overrides original warning review status [EXPECTED RED]', () => {
  const source = {
    ...sample(),
    source: 'url',
    sourceUrl: 'https://www.fictional-recipes.nl/soep',
    warnings: ['Controleer JSON-LD ingrediëntafmetingen'],
  }
  const preview = previewLocalRecipePortions(source, 2)
  assert.equal(preview.sourceAssessment.accepted, true)
  assert.equal(preview.sourceAssessment.fetchReady, false)
  assert.equal(preview.needsReview, true,
    'URL string shape acceptance must not waive review of imported ingredient warnings')
  assert.equal(preview.fetchAuthorized, false)
  assert.equal(preview.cloudSaved, false)
})
