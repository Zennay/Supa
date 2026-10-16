/**
 * Independent QA for product-owned private portion scaler PR #3268,
 * exact frozen SHA 082b68105f3424e72547e4c86726a0633cfafa17.
 * A returned scaled recipe is an editable draft, not an alias to the old
 * draft's mutable steps/warnings. Pure synthetic data, zero network/retailer.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { scaleMetricRecipeDraft } from '../src/domain/userRecipePortions.ts'

function makeDraft() {
  return {
    title: 'Fictief recept',
    source: 'manual',
    sourceUrl: null,
    status: 'needs_review',
    servings: 2,
    minutes: 25,
    steps: ['Snijd de courgette', 'Verhit olie'],
    warnings: ['Controleer de bereidingstijd'],
    ingredients: [{
      original: '100 g courgette', label: 'Courgette', query: 'courgette',
      amount: 100, unit: 'g', reviewReason: null,
    }],
  }
}

test('positive scaler adjusts known gram quantity and does not directly mutate input', () => {
  const input = makeDraft()
  const before = structuredClone(input)
  const result = scaleMetricRecipeDraft(input, 4)
  assert.equal(result.draft.servings, 4)
  assert.equal(result.draft.ingredients[0].amount, 200)
  assert.deepEqual(input, before)
})

test('editing scaled draft cooking steps must not silently mutate the source recipe [EXPECTED RED]', () => {
  const input = makeDraft()
  const before = structuredClone(input)
  const result = scaleMetricRecipeDraft(input, 4)
  assert.deepEqual(result.draft.steps, before.steps)
  assert.notEqual(result.draft.steps, input.steps,
    'new editable draft cannot share its step-array identity with original')
  result.draft.steps[0] = 'Kook in plaats van snijden'
  result.draft.steps.push('Voeg verse kruiden toe')
  assert.deepEqual(input, before,
    'downstream editing a scaled recipe must not alter unsaved original recipe text')
})

test('review warnings in scaled draft must not be writable through the original draft [EXPECTED RED]', () => {
  const input = makeDraft()
  const before = structuredClone(input)
  const result = scaleMetricRecipeDraft(input, 3)
  assert.deepEqual(result.draft.warnings, before.warnings)
  assert.notEqual(result.draft.warnings, input.warnings,
    'an editable scaled draft must not retain an alias to source review warnings')
  result.draft.warnings.push('Extra handmatige controle')
  assert.deepEqual(input, before,
    'downstream review-state modifications cannot contaminate original recipe')
})

test('frozen steps and warning arrays still permit a scaling result', () => {
  const input = makeDraft()
  Object.freeze(input.steps)
  Object.freeze(input.warnings)
  Object.freeze(input.ingredients[0])
  Object.freeze(input.ingredients)
  Object.freeze(input)
  const scaled = scaleMetricRecipeDraft(input, 1)
  assert.equal(scaled.draft.ingredients[0].amount, 50)
  assert.equal(scaled.draft.servings, 1)
})
