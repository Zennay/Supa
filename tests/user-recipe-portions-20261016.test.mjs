import test from 'node:test'
import assert from 'node:assert/strict'
import { scaleMetricRecipeDraft } from '../src/domain/userRecipePortions.ts'

const recipe = (servings, ingredients) => ({
  source: 'manual', title: 'Tikka bowl', servings, minutes: 25,
  steps: ['Bakken'], sourceUrl: null, status: 'needs_review',
  ingredients: ingredients.map(([amount, unit, reviewReason = null]) => ({ amount, unit, reviewReason, original: 'raw' })),
})

test('2 → 4 portions scales g/ml/pieces exactly without changing source or other fields', () => {
  const input = recipe(2, [[125, 'g'], [80, 'ml'], [2, 'piece']])
  const original = structuredClone(input)
  const result = scaleMetricRecipeDraft(input, 4)
  assert.equal(result.status, 'scaled')
  assert.deepEqual(result.draft.ingredients.map((x) => x.amount), [250, 160, 4])
  assert.equal(result.draft.servings, 4)
  assert.equal(result.draft.title, 'Tikka bowl')
  assert.deepEqual(input, original)
  assert.notEqual(result.draft.ingredients[0], input.ingredients[0])
})

test('unknown base servings does not pretend to rescale or change portion count', () => {
  const input = recipe(null, [[120, 'g']])
  const output = scaleMetricRecipeDraft(input, 4)
  assert.equal(output.status, 'needs_review')
  assert.equal(output.draft.servings, null)
  assert.equal(output.draft.ingredients[0].amount, 120)
  assert.deepEqual(output.warnings.map((w) => w.code), ['unknown_base_servings'])
})

test('unknown imported quantities stay null and carry reviewReason', () => {
  const output = scaleMetricRecipeDraft(recipe(2, [[null, null]]), 6)
  assert.equal(output.draft.ingredients[0].amount, null)
  assert.match(output.draft.ingredients[0].reviewReason, /Controleer/)
  assert.ok(output.warnings.some((w) => w.code === 'unknown_ingredient'))
})

test('fractional pieces are visible and require user review rather than silently rounding onions', () => {
  const output = scaleMetricRecipeDraft(recipe(2, [[1, 'piece']]), 3)
  assert.equal(output.draft.ingredients[0].amount, 1.5)
  assert.equal(output.status, 'needs_review')
  assert.ok(output.warnings.some((w) => w.code === 'fractional_piece'))
  assert.match(output.draft.ingredients[0].reviewReason, /deel van een stuk/)
})

test('rounding is explicit, decimal arithmetic is limited to 3 decimal places', () => {
  const output = scaleMetricRecipeDraft(recipe(3, [[1, 'g']]), 1)
  assert.equal(output.draft.ingredients[0].amount, 0.333)
  assert.equal(output.status, 'needs_review')
  assert.ok(output.warnings.some((w) => w.code === 'rounded_quantity'))
})

test('invalid target portions refuse without modifying source', () => {
  const input = recipe(2, [[120, 'g']])
  for (const target of [0, -1, 1.25, 1001, NaN, Infinity]) {
    assert.throws(() => scaleMetricRecipeDraft(input, target), RangeError)
  }
  assert.equal(input.servings, 2)
  assert.equal(input.ingredients[0].amount, 120)
})

test('invalid source amount and unsupported units stay unresolved, never zero or prices', () => {
  const input = recipe(2, [[Infinity, 'g'], [1, 'cup'], [0, 'ml'], [-12, 'piece']])
  const output = scaleMetricRecipeDraft(input, 4)
  assert.deepEqual(output.draft.ingredients.map((x) => x.amount), [null, null, null, null])
  assert.equal(output.status, 'needs_review')
  assert.equal('estimatedCost' in output.draft, false)
  assert.equal(output.warnings.filter((w) => w.code === 'invalid_ingredient').length, 4)
})

test('quantities outside precision or safety bound are unresolved', () => {
  const tiny = scaleMetricRecipeDraft(recipe(1000, [[0.001, 'g']]), 1)
  assert.equal(tiny.draft.ingredients[0].amount, null)
  assert.ok(tiny.warnings.some((w) => w.code === 'quantity_below_precision'))
  const huge = scaleMetricRecipeDraft(recipe(1, [[999_000_000, 'g']]), 1000)
  assert.equal(huge.draft.ingredients[0].amount, null)
  assert.ok(huge.warnings.some((w) => w.code === 'quantity_over_limit'))
})

test('existing review flags survive scaling and require review', () => {
  const output = scaleMetricRecipeDraft(recipe(2, [[100, 'g', 'Imported quantity uncertain']]), 4)
  assert.equal(output.draft.ingredients[0].amount, 200)
  assert.equal(output.draft.ingredients[0].reviewReason, 'Imported quantity uncertain')
  assert.ok(output.warnings.some((w) => w.code === 'prior_review_required'))
})

test('no mutation even when input is frozen', () => {
  const input = recipe(2, [[50, 'ml']])
  Object.freeze(input.ingredients[0]); Object.freeze(input.ingredients); Object.freeze(input)
  const output = scaleMetricRecipeDraft(input, 1)
  assert.equal(output.draft.ingredients[0].amount, 25)
})
