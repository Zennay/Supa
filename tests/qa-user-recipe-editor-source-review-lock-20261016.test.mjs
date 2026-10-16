/**
 * Independent QA on frozen product-core recipe draft editor PR #3274 at
 * d1a4aaa95f4850317c2f29d0be45fe642ed3b675.
 * Tests only the review gate, no network, renderer, customer data, or storage.
 * Imported uncertainty cannot be silently resolved by editing a NAME alone.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyUserRecipeDraft,
  updateEditorIngredient,
  addEditorIngredient,
  canConfirmUserRecipeDraft,
  prepareImportedRecipeForEditor,
} from '../src/features/user-recipes/userRecipeDraftEditor.ts'

function importedUncertainDraft() {
  const empty = emptyUserRecipeDraft()
  return prepareImportedRecipeForEditor({
    ...empty,
    source: 'url',
    sourceUrl: 'https://recipe.example.invalid/fictional',
    title: 'Fictieve soep',
    servings: 2,
    ingredients: [{
      original: '2 schepjes bloem (handmatige beoordeling nodig)',
      label: 'Bloem',
      query: 'bloem',
      amount: 100,
      unit: 'g',
      reviewReason: 'Controleer conversie: schepjes hebben geen vaste massa',
    }],
    warnings: ['Ingrediënt 1: maat niet bewezen'],
  })
}

test('imported ingredient uncertainty remains a blocking review after changing label only [EXPECTED RED]', () => {
  const initial = importedUncertainDraft()
  assert.equal(canConfirmUserRecipeDraft(initial), false)
  const edited = updateEditorIngredient(initial, 0, { label: 'Bloem voor soep' })
  assert.equal(initial.ingredients[0].reviewReason, 'Controleer conversie: schepjes hebben geen vaste massa')
  assert.equal(edited.ingredients[0].reviewReason,
    'Controleer conversie: schepjes hebben geen vaste massa',
    'renaming a food never proves a conversion or source measurement')
  assert.equal(canConfirmUserRecipeDraft(edited), false,
    'a previously unverified import must not become a confirmable recipe on name edit alone')
  assert.equal(edited.ingredients[0].original, initial.ingredients[0].original)
})

test('repeated name-only corrections must not silently approve an imported uncertain amount [EXPECTED RED]', () => {
  const original = importedUncertainDraft()
  const first = updateEditorIngredient(original, 0, { label: 'Bloem, volkoren' })
  const second = updateEditorIngredient(first, 0, { label: 'Volkorenbloem' })
  assert.ok(second.ingredients[0].reviewReason,
    'multiple cosmetic changes must not erase an unresolved source measure')
  assert.equal(canConfirmUserRecipeDraft(second), false)
  assert.deepEqual(original.warnings, ['Ingrediënt 1: maat niet bewezen'])
  assert.equal(original.ingredients[0].label, 'Bloem', 'caller input immutable')
})

test('adding a second ingredient cannot resolve review of a different imported row [EXPECTED RED]', () => {
  const imported = importedUncertainDraft()
  const expanded = addEditorIngredient(imported)
  const changed = updateEditorIngredient(expanded, 0, { label: 'Zachte bloem' })
  const fixedSecond = updateEditorIngredient(changed, 1, { label: 'Water', amount: 400, unit: 'ml' })
  assert.equal(fixedSecond.ingredients[1].reviewReason, null)
  assert.equal(fixedSecond.ingredients[0].reviewReason,
    'Controleer conversie: schepjes hebben geen vaste massa')
  assert.equal(canConfirmUserRecipeDraft(fixedSecond), false)
  assert.equal(imported.ingredients.length, 1)
})

test('explicit metric amount/unit correction may resolve importer uncertainty', () => {
  const initial = importedUncertainDraft()
  const corrected = updateEditorIngredient(initial, 0, { label: 'Bloem', amount: 200, unit: 'g' })
  assert.equal(corrected.ingredients[0].reviewReason, null)
  assert.equal(canConfirmUserRecipeDraft(corrected), true,
    'explicit user correction is allowed to clear an ingredient-specific review')
  assert.ok(initial.ingredients[0].reviewReason, 'original imported record remains unchanged')
})

test('fresh manually entered metric ingredient passes after real field completion', () => {
  let draft = emptyUserRecipeDraft()
  draft = { ...draft, title: 'Fictieve soep' }
  draft = updateEditorIngredient(draft, 0, { label: 'Bloem', amount: 200, unit: 'g' })
  assert.equal(canConfirmUserRecipeDraft(draft), true)
})
