/**
 * Independent SUPA quality-validation on frozen studio product owner #3347:
 * 368831fe28d20684416f3971e4d00ce429304fed.
 * Studio must not mark an untrusted stale/foreign controlled week selection
 * ready to confirm when its child planner correctly rejects that selection.
 * Synthetic in-memory recipe callbacks only, no retailer, storage, or network.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PrivateRecipeStudio } from '../src/features/user-recipes/PrivateRecipeStudio.ts'
import { prepareUnpricedPrivateRecipe } from '../src/features/user-recipes/reviewedRecipeBasketBridge.ts'
import { createPrivateRecipeWeekPreview } from '../src/features/user-recipes/privateWeekPlanner.ts'

function MockEditor() { return null }
function draft() {
  return {
    source: 'manual', sourceUrl: null, title: 'Fictieve pastasoep',
    servings: 2, minutes: 15, status: 'needs_review', warnings: [],
    steps: ['Roer 10 minuten'], ingredients: [{
      clientId: 'fake-1', original: '200 g pasta', label: 'Pasta',
      query: 'pasta', amount: 200, unit: 'g', reviewReason: null,
    }],
  }
}
function savedRecipe() {
  const result = prepareUnpricedPrivateRecipe(draft(), 'saved')
  assert.equal(result.status, 'unpriced_ready')
  return result.recipe
}
function renderStudio(selectedDays, recipes) {
  const added = []
  const src = draft()
  const outer = PrivateRecipeStudio({
    draft: src,
    draftLocalId: 'pending',
    recipes,
    selectedDays,
    EditorComponent: MockEditor,
    onDraftChange() {},
    onSelectedDaysChange() {},
    onCancelDraft() {},
    onAddReviewedRecipe(recipe) { added.push(recipe) },
  })
  const editor = outer.props.children.find(child => child?.type === MockEditor)
  assert.ok(editor)
  const admissionText = outer.props.children.find(child => child?.props?.role === 'status' ||
    child?.props?.role === 'note')
  assert.ok(admissionText)
  return { confirm: editor.props.onConfirm, admissionText, added, src }
}

test('positive: valid empty local week and existing IDs retain unpriced recipe confirmation', () => {
  for (const [selection, recipes] of [[{}, []], [{ Ma: 'private-recipe:saved' }, [savedRecipe()]]]) {
    const view = renderStudio(selection, recipes)
    view.confirm(view.src)
    view.confirm(view.src)
    assert.equal(view.added.length, 1)
    assert.equal(view.added[0].id, 'private-recipe:pending')
    assert.equal(view.added[0].priceStatus, 'unknown')
    assert.equal(view.added[0].estimatedCost, null)
  }
})

for (const [caseName, selection] of [
  ['unknown private recipe ID', { Ma: 'private-recipe:missing' }],
  ['noncanonical selection identity', { Wo: 'foreign:unreviewed' }],
]) {
  test('studio must not admit new recipe when week selection refers to ' + caseName + ' [EXPECTED RED]', () => {
    const recipes = [savedRecipe()]
    assert.deepEqual(createPrivateRecipeWeekPreview(recipes, selection),
      { status: 'review_required', reason: 'invalid_selection' },
      'core week planner already rejects stale/foreign week references')
    const view = renderStudio(selection, recipes)
    assert.equal(view.admissionText.props.role, 'status',
      'parent must not advertise ready when its controlled child is invalid')
    view.confirm(view.src)
    assert.deepEqual(view.added, [],
      'invalid host-selected recipe references must not enqueue a new local draft')
  })
}
