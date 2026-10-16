import test from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyUserRecipeDraft, parseMetricEditorAmount,
  updateEditorIngredient, addEditorIngredient, removeEditorIngredient,
  canConfirmUserRecipeDraft, prepareImportedRecipeForEditor, displayMetricEditorAmount,
} from '../src/features/user-recipes/userRecipeDraftEditor.ts'

test('empty manual draft starts in review, not as saved priced recipe', () => {
  const draft = emptyUserRecipeDraft()
  assert.equal(draft.status, 'needs_review')
  assert.equal(draft.source, 'manual')
  assert.equal(canConfirmUserRecipeDraft(draft), false)
  assert.equal('estimatedCost' in draft, false)
  assert.equal('id' in draft, false)
})

test('Dutch metric decimal input is bounded and never guesses cup/imperial quantities', () => {
  for (const [value, expected] of [['100', 100], ['1,5', 1.5], ['0.125', 0.125], ['1.000', 1], ['1e5', null], ['', null], ['0', null], ['-1', null], ['Infinity', null], ['1,2345', null]]) {
    assert.equal(parseMetricEditorAmount(value), expected, value)
  }
})

test('editable reviewed draft is returned as new object without mutating imported original', () => {
  const draft = emptyUserRecipeDraft()
  draft.title = 'Kip bowl'
  const amount = updateEditorIngredient(draft, 0, { label: 'Courgette', amount: 150, unit: 'g' })
  assert.equal(amount.ingredients[0].query, 'courgette')
  assert.equal(amount.ingredients[0].reviewReason, null)
  assert.equal(canConfirmUserRecipeDraft(amount), true)
  assert.equal(draft.ingredients[0].amount, null)
  assert.notEqual(amount.ingredients[0], draft.ingredients[0])
})

test('ingredients add/remove are bounded, immutable, and reject invalid indexes', () => {
  const draft = emptyUserRecipeDraft()
  const added = addEditorIngredient(draft)
  assert.equal(added.ingredients.length, 2)
  assert.equal(draft.ingredients.length, 1)
  assert.notEqual(added.ingredients[0].clientId, added.ingredients[1].clientId)
  assert.equal(added.ingredients[0].clientId, draft.ingredients[0].clientId)
  const removed = removeEditorIngredient(added, 1)
  assert.equal(removed.ingredients.length, 1)
  assert.equal(removeEditorIngredient(added, -1), added)
  assert.equal(updateEditorIngredient(added, 99, { amount: 3 }), added)
})

test('missing amount, invalid unit, huge grams or imported review warning cannot confirm', () => {
  const base = emptyUserRecipeDraft()
  base.title = 'Tomatensoep'
  const badUnit = updateEditorIngredient(base, 0, {label: 'Water', amount: 100, unit: 'cup'})
  assert.equal(canConfirmUserRecipeDraft(badUnit), false)
  const huge = updateEditorIngredient(base, 0, {label: 'Water', amount: 1e12, unit: 'ml'})
  assert.equal(canConfirmUserRecipeDraft(huge), false)
  const overlyPrecise = updateEditorIngredient(base, 0, {label: 'Water', amount: 0.0001, unit: 'ml'})
  assert.equal(canConfirmUserRecipeDraft(overlyPrecise), false)
  const good = updateEditorIngredient(base, 0, {label: 'Water', amount: 100, unit: 'ml'})
  assert.equal(canConfirmUserRecipeDraft(good), true)
  const noServings = {...good, servings: null}
  assert.equal(canConfirmUserRecipeDraft(noServings), false)
})

test('ingredient review reason can be cleared by explicitly editing to a known metric quantity', () => {
  const source = emptyUserRecipeDraft()
  source.ingredients[0] = {clientId: source.ingredients[0].clientId, original:'1 cup bloem',label:'Bloem',query:'bloem',amount:null,unit:null,reviewReason:'Cups not convertible'}
  const edited = updateEditorIngredient(source, 0, { amount: 100, unit: 'g' })
  assert.equal(edited.ingredients[0].reviewReason, null)
  assert.equal(source.ingredients[0].reviewReason, 'Cups not convertible')
})

test('imported parser drafts receive stable local row IDs without modifying original source', () => {
  const original = emptyUserRecipeDraft()
  const imported = { ...original, ingredients: original.ingredients.map(({ clientId, ...rest }) => rest) }
  const adapted = prepareImportedRecipeForEditor(imported)
  assert.ok(adapted.ingredients[0].clientId.startsWith('local-ingredient-'))
  assert.equal('clientId' in imported.ingredients[0], false)
  const updated = updateEditorIngredient(adapted, 0, { label: 'Tomaat' })
  assert.equal(updated.ingredients[0].clientId, adapted.ingredients[0].clientId)
})

test('unfinished decimal input stays on the same semantic row and yields to external amount changes', () => {
  const start = emptyUserRecipeDraft()
  const another = addEditorIngredient(start)
  const [first, second] = another.ingredients
  assert.notEqual(first.clientId, second.clientId)
  const rawByClientId = { [first.clientId]: '1,', [second.clientId]: '2,5' }
  assert.equal(displayMetricEditorAmount(rawByClientId[first.clientId], null), '1,')
  assert.equal(displayMetricEditorAmount(rawByClientId[second.clientId], 2.5), '2,5')
  const shifted = removeEditorIngredient(another, 0)
  assert.equal(shifted.ingredients[0].clientId, second.clientId)
  assert.equal(displayMetricEditorAmount(rawByClientId[shifted.ingredients[0].clientId], 2.5), '2,5')
  assert.equal(displayMetricEditorAmount(rawByClientId[second.clientId], 10), '10')
  assert.equal(displayMetricEditorAmount(undefined, null), '')
  assert.equal(displayMetricEditorAmount('2,5', 2.5), '2,5')
})
