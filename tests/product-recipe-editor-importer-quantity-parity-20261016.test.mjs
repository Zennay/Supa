/** Strict metric editor/importer parity #3287/#3288 (pure fictional drafts). */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyUserRecipeDraft, parseMetricEditorAmount,
  updateEditorIngredient, canConfirmUserRecipeDraft,
} from '../src/features/user-recipes/userRecipeDraftEditor.ts'

function ready() {
  const a = emptyUserRecipeDraft()
  return { ...a, title: 'Fictieve salade', servings: 2 }
}
for (const unit of ['g', 'ml', 'piece']) {
  for (const amount of [1_000_001, 999_999_999, 1_000_000_000]) {
    test('editor requires review for beyond-importer quantity ' + amount + ' ' + unit, () => {
      const source = ready()
      const edited = updateEditorIngredient(source, 0, {
        label: 'Fictief ingrediënt', amount, unit,
      })
      assert.equal(canConfirmUserRecipeDraft(edited), false)
      assert.ok(edited.ingredients[0].reviewReason,
        'never mark an out-of-bounds amount complete')
      assert.equal(edited.ingredients[0].amount, amount,
        'preserve the human-entered amount for explicit correction')
      assert.equal(source.ingredients[0].amount, null)
    })
  }
  test('editor accepts canonical max 1,000,000 ' + unit + ' without guessing', () => {
    const edited = updateEditorIngredient(ready(), 0, {
      label: 'Fictief ingrediënt', amount: 1_000_000, unit,
    })
    assert.equal(canConfirmUserRecipeDraft(edited), true)
    assert.equal(edited.ingredients[0].reviewReason, null)
  })
}
for (const text of ['1000001', '999999999', '1000000000', '1000001,001']) {
  test('typed metric quantity greater than importer bound is not silently admitted: ' + text, () => {
    assert.equal(parseMetricEditorAmount(text), null)
  })
}
for (const [typed, expected] of [
  ['1000000', 1_000_000], ['1000000,000', 1_000_000],
  ['0,250', 0.25], ['2.500', 2.5], ['12,05', 12.05],
]) {
  test('valid metric comma/dot amount remains precise: ' + typed, () => {
    assert.equal(parseMetricEditorAmount(typed), expected)
  })
}
test('directly forged otherwise-ready editor draft cannot bypass confirm gate', () => {
  const draft = updateEditorIngredient(ready(), 0, {
    label: 'Fictief ingrediënt', amount: 250, unit: 'g',
  })
  draft.ingredients[0].amount = 1_000_001
  draft.ingredients[0].reviewReason = null
  assert.equal(canConfirmUserRecipeDraft(draft), false)
})
