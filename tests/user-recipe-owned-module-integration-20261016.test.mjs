import test from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyUserRecipeDraft,
  updateEditorIngredient,
  addEditorIngredient,
} from '../src/features/user-recipes/userRecipeDraftEditor.ts'
import {
  previewLocalRecipePortions,
  saveLocalRecipeReviewDraft,
  restoreLocalRecipeReviewDraft,
} from '../src/features/user-recipes/recipeDraftFlow.ts'

const ID = '3399ee88-1122-4acc-8abb-334455667788'
function device() {
  const records = new Map()
  return {
    records,
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, val) => records.set(key, val),
    removeItem: (key) => records.delete(key),
  }
}
function example() {
  const start = emptyUserRecipeDraft()
  start.title = 'Kip bowl'
  const first = updateEditorIngredient(start, 0, { label: 'Kip', amount: 125, unit: 'g' })
  const withTwo = addEditorIngredient(first)
  return updateEditorIngredient(withTwo, 1, { label: 'Saus', amount: 80, unit: 'ml' })
}

test('manual edit → porties 2 to 4 yields exact g/ml, immutable original and no false price/network claims', () => {
  const draft = example()
  const snapshot = structuredClone(draft)
  const preview = previewLocalRecipePortions(draft, 4)
  assert.equal(preview.draft.servings, 4)
  assert.deepEqual(preview.draft.ingredients.map((i) => i.amount), [250, 160])
  assert.equal(preview.needsReview, false)
  assert.equal(preview.fetchAuthorized, false)
  assert.equal(preview.cloudSaved, false)
  assert.equal(preview.sourceAssessment, null)
  assert.equal('estimatedCost' in preview.draft, false)
  assert.deepEqual(draft, snapshot)
})

test('URL origin with token is not admitted as a fetch authority, but explicit local draft save scrubs link', () => {
  const draft = {...example(), source: 'url', sourceUrl: 'https://recipes.nl/?access_token=SECRET'}
  const preview = previewLocalRecipePortions(draft, 4)
  assert.equal(preview.sourceAssessment.accepted, false)
  assert.equal(preview.needsReview, true)
  assert.equal(preview.fetchAuthorized, false)
  const storage = device()
  const saved = saveLocalRecipeReviewDraft(storage, ID, draft, null, true)
  assert.equal(saved.status, 'saved')
  const persisted = JSON.stringify([...storage.records.values()])
  assert.doesNotMatch(persisted, /SECRET|access_token|clientId|estimatedCost/)
  const result = restoreLocalRecipeReviewDraft(storage, ID)
  assert.equal(result.status, 'found')
  assert.equal(result.draft.sourceUrl, null)
  assert.equal(result.draft.source, 'url')
})

test('users must explicitly opt in to unencrypted on-device draft storage', () => {
  const storage = device()
  assert.equal(saveLocalRecipeReviewDraft(storage, ID, example(), null, false).status, 'consent_required')
  assert.equal(storage.records.size, 0)
  assert.equal(restoreLocalRecipeReviewDraft(storage, ID).status, 'missing')
})

test('stale tab cannot silently overwrite, restored draft receives new independent row identities', () => {
  const storage = device()
  const draft = example()
  const saved = saveLocalRecipeReviewDraft(storage, ID, draft, null, true)
  assert.equal(saved.status, 'saved')
  const restored = restoreLocalRecipeReviewDraft(storage, ID)
  assert.equal(restored.revision, 1)
  assert.equal(restored.draft.ingredients[0].amount, 125)
  assert.notEqual(restored.draft.ingredients[0].clientId, draft.ingredients[0].clientId)
  const updated = {...restored.draft, title: 'Gewijzigde bowl'}
  assert.equal(saveLocalRecipeReviewDraft(storage, ID, updated, 1, true).status, 'saved')
  assert.equal(saveLocalRecipeReviewDraft(storage, ID, draft, 1, true).status, 'conflict')
  assert.equal(restoreLocalRecipeReviewDraft(storage, ID).draft.title, 'Gewijzigde bowl')
})

test('fractional pieces and unknown imported measurements remain explicit review items', () => {
  const source = emptyUserRecipeDraft()
  source.title = 'Uien gerecht'
  const onion = updateEditorIngredient(source, 0, { label: 'Ui', amount: 1, unit: 'piece' })
  const scaled = previewLocalRecipePortions(onion, 3)
  assert.equal(scaled.draft.ingredients[0].amount, 1.5)
  assert.equal(scaled.needsReview, true)
  assert.ok(scaled.portionWarnings.some((x) => x.code === 'fractional_piece'))

  const uncertain = { ...source, ingredients: [{...source.ingredients[0],label:'Bloem',query:'bloem',amount:null,unit:null,reviewReason:'Unknown cup'}] }
  const incomplete = previewLocalRecipePortions(uncertain, 2)
  assert.equal(incomplete.needsReview, true)
  assert.equal(incomplete.draft.ingredients[0].amount, null)
  const store = device()
  assert.equal(saveLocalRecipeReviewDraft(store, ID, uncertain, null, true).status, 'saved')
  assert.equal(restoreLocalRecipeReviewDraft(store, ID).draft.ingredients[0].amount, null)
})

test('preview HTTPS source is still fetchAuthorized:false even when URL shape accepted', () => {
  const source = {...example(), source:'url',sourceUrl:'https://www.goederecepten.nl/recept/bowl'}
  const preview = previewLocalRecipePortions(source, 2)
  assert.equal(preview.sourceAssessment.accepted, true)
  assert.equal(preview.sourceAssessment.fetchReady, false)
  assert.equal(preview.fetchAuthorized, false)
  assert.equal(preview.cloudSaved, false)
})
