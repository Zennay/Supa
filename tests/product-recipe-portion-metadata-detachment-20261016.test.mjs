/**
 * Product #3283: cloned serving previews must not alias the original recipe
 * instructions or provenance review arrays. Pure fictional in-memory tests.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { scaleMetricRecipeDraft } from '../src/domain/userRecipePortions.ts'

function example(servings = 2) {
  return {
    title: 'Fictieve rijst', servings,
    steps: ['Kook de rijst'], warnings: ['Controleer originele herkomst'],
    ingredients: [{ label: 'Fictieve rijst', amount: 200, unit: 'g', reviewReason: null }],
  }
}
for (const servings of [2, null]) {
  test('scaled ' + servings + ' portions detach mutable metadata and ingredient rows', () => {
    const source = example(servings)
    const original = structuredClone(source)
    const outcome = scaleMetricRecipeDraft(source, 4)
    assert.notStrictEqual(outcome.draft, source)
    assert.notStrictEqual(outcome.draft.ingredients, source.ingredients)
    assert.notStrictEqual(outcome.draft.ingredients[0], source.ingredients[0])
    assert.notStrictEqual(outcome.draft.steps, source.steps)
    assert.notStrictEqual(outcome.draft.warnings, source.warnings)
    assert.deepEqual(outcome.draft.steps, source.steps)
    assert.deepEqual(outcome.draft.warnings, source.warnings)
    outcome.draft.steps.push('Bakken')
    outcome.draft.warnings.push('Extra review')
    outcome.draft.ingredients[0].label = 'Ander label'
    assert.deepEqual(source, original, 'scaled draft edits never mutate original')
    assert.equal(outcome.status, servings === null ? 'needs_review' : 'scaled')
  })
}
test('frozen inputs can still be scaled without mutation', () => {
  const source = example()
  Object.freeze(source.steps)
  Object.freeze(source.warnings)
  Object.freeze(source.ingredients[0])
  Object.freeze(source.ingredients)
  Object.freeze(source)
  const outcome = scaleMetricRecipeDraft(source, 3)
  outcome.draft.steps.push('Extra bereiding')
  outcome.draft.warnings.push('Extra controle')
  assert.equal(outcome.draft.ingredients[0].amount, 300)
  assert.deepEqual(source.steps, ['Kook de rijst'])
  assert.deepEqual(source.warnings, ['Controleer originele herkomst'])
})
test('generic portion callers without steps/warnings still behave identically', () => {
  const source = { servings: 2, ingredients: [{ amount: 50, unit: 'ml', reviewReason: null }] }
  const scaled = scaleMetricRecipeDraft(source, 4)
  assert.equal(scaled.status, 'scaled')
  assert.equal(scaled.draft.ingredients[0].amount, 100)
  assert.equal('steps' in scaled.draft, false)
  assert.equal('warnings' in scaled.draft, false)
})
