/**
 * Independent QA on frozen product studio owner #3303, exact source
 * 7bf7286f595f6231df29823419a5e84b9f6eb629.
 * A rapid confirm double-click must not emit the same not-yet-persisted
 * local recipe twice before the parent can render fresh recipe IDs.
 * No account, browser, network, retailer, data write or price involved.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PrivateRecipeStudio } from '../src/features/user-recipes/PrivateRecipeStudio.ts'

function MockEditor() { return null }
function draft() {
  return {
    source: 'manual', sourceUrl: null, title: 'Fictieve rijstsoep',
    servings: 2, minutes: 15, warnings: [], status: 'needs_review',
    steps: ['Roer de soep'],
    ingredients: [{
      clientId: 'local-row-1', original: '200 g rijst', label: 'Rijst',
      query: 'rijst', amount: 200, unit: 'g', reviewReason: null,
    }],
  }
}
function makeConfirm(added) {
  const source = draft()
  const studio = PrivateRecipeStudio({
    draft: source, draftLocalId: 'private-double-click-case',
    recipes: [], selectedDays: {},
    EditorComponent: MockEditor,
    onDraftChange() {}, onSelectedDaysChange() {}, onCancelDraft() {},
    onAddReviewedRecipe(recipe) { added.push(recipe) },
  })
  const editor = studio.props.children.find(child => child?.type === MockEditor)
  assert.ok(editor)
  return { confirm: editor.props.onConfirm, source }
}

test('positive: one valid editor confirmation emits an unpriced local recipe', () => {
  const added = []
  const { confirm, source } = makeConfirm(added)
  confirm(source)
  assert.equal(added.length, 1)
  assert.equal(added[0].id, 'private-recipe:private-double-click-case')
  assert.equal(added[0].priceStatus, 'unknown')
  assert.equal(added[0].estimatedCost, null)
})

test('rapid duplicate onConfirm must not append same local ID twice before rerender [EXPECTED RED]', () => {
  const added = []
  const { confirm, source } = makeConfirm(added)
  confirm(source)
  confirm(source)
  assert.equal(added.length, 1,
    'two clicks on one rendered editor should not queue two identical recipe creations')
  assert.equal(added[0].id, 'private-recipe:private-double-click-case')
  assert.equal(added[0].estimatedCost, null)
})

test('rejected invalid confirmation cannot emit a recipe', () => {
  const added = []
  const { confirm, source } = makeConfirm(added)
  confirm({ ...source, minutes: null })
  assert.equal(added.length, 0)
})
