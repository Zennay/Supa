/**
 * Independent Supa QA 2/2 against frozen editor owner #3274
 * HEAD 75e79241c7ccc4b7d966b1f9394f32286d5575b9.
 * The editor must not confirm a value above the existing imported metric
 * normalization ceiling of 1,000,000 g/ml/pieces (#3264).
 * Pure fictional in-memory model, no retailer/source requests.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyUserRecipeDraft, parseMetricEditorAmount,
  updateEditorIngredient, canConfirmUserRecipeDraft,
} from '../src/features/user-recipes/userRecipeDraftEditor.ts'

function editable() {
  const draft = emptyUserRecipeDraft()
  return { ...draft, title: 'Fictief recept', servings: 2 }
}

test('positive: editor can confirm importer-ceiling 1000000 grams', () => {
  const result = updateEditorIngredient(editable(), 0, {
    label: 'Fictieve rijst', amount: 1_000_000, unit: 'g',
  })
  assert.equal(canConfirmUserRecipeDraft(result), true)
  assert.equal(parseMetricEditorAmount('1000000'), 1_000_000)
  assert.equal('estimatedCost' in result, false)
})

for (const [display, amount, unit] of [
  ['one gram over importer ceiling', 1_000_001, 'g'],
  ['one millilitre over importer ceiling', 1_000_001, 'ml'],
  ['huge piece count beyond importer ceiling', 999_999_999, 'piece'],
]) {
  test('editor cannot confirm importer-invalid amount: ' + display + ' [EXPECTED RED]', () => {
    const input = editable()
    const edited = updateEditorIngredient(input, 0, {
      label: 'Fictief ingrediënt', amount, unit,
    })
    assert.equal(canConfirmUserRecipeDraft(edited), false,
      'an editor-confirmed recipe cannot bypass canonical imported metric bounds')
    assert.ok(edited.ingredients[0].reviewReason,
      'out-of-contract amount requires explicit correction')
    assert.equal(input.ingredients[0].amount, null)
  })
}

test('editor parse helper refuses amount 1000001 inconsistent with importer [EXPECTED RED]', () => {
  assert.equal(parseMetricEditorAmount('1000001'), null)
  assert.equal(parseMetricEditorAmount('999999999'), null)
})

test('existing normal metric amounts remain exact', () => {
  for (const [input, value] of [['250', 250], ['1,5', 1.5], ['0.125', 0.125]]) {
    assert.equal(parseMetricEditorAmount(input), value)
  }
})
