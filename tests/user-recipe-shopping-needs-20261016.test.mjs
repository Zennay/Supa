import test from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyUserRecipeDraft,
  addEditorIngredient,
  updateEditorIngredient,
} from '../src/features/user-recipes/userRecipeDraftEditor.ts'
import { previewPrivateRecipeShoppingNeeds } from '../src/features/user-recipes/userRecipeShoppingNeeds.ts'

function withRows(rows, servings = 2) {
  let result = emptyUserRecipeDraft()
  result.title = 'Mijn gerecht'
  result.servings = servings
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) result = addEditorIngredient(result)
    const [label, amount, unit] = rows[i]
    result = updateEditorIngredient(result, i, { label, amount, unit })
  }
  return result
}

test('duplicate exactly identical grams add after 2→4 scale and never include price', () => {
  const recipe = withRows([['Kip', 100, 'g'], ['Kip', 50, 'g']])
  const before = structuredClone(recipe)
  const list = previewPrivateRecipeShoppingNeeds(recipe, 4)
  assert.equal(list.status, 'complete_unpriced')
  assert.equal(list.lines.length, 1)
  assert.deepEqual(list.lines[0], {
    status: 'known_unpriced', label: 'Kip', query: 'kip', amount: 300, unit: 'g', priceCents: null,
  })
  assert.equal(list.priced, false)
  assert.equal(list.retailerComparisonAvailable, false)
  assert.deepEqual(recipe, before)
})

test('mass and volume same label are not equivalent and not merged', () => {
  const recipe = withRows([['Water', 100, 'ml'], ['Water', 10, 'g']])
  const preview = previewPrivateRecipeShoppingNeeds(recipe, 2)
  assert.equal(preview.lines.length, 2)
  assert.deepEqual(preview.lines.map((line) => line.unit), ['ml', 'g'])
})

test('binary decimal sums use existing exact arithmetic, not unsafe floating sum', () => {
  const recipe = withRows([['Gember', 0.1, 'g'], ['Gember', 0.2, 'g']])
  const preview = previewPrivateRecipeShoppingNeeds(recipe, 2)
  assert.equal(preview.lines.length, 1)
  assert.equal(preview.lines[0].amount, 0.3)
  assert.equal(preview.status, 'complete_unpriced')
})

test('unknown cup amount stays unresolved instead of turning into a free product', () => {
  const input = withRows([['Bloem', null, null], ['Kip', 100, 'g']])
  const list = previewPrivateRecipeShoppingNeeds(input, 4)
  assert.equal(list.status, 'needs_review')
  assert.equal(list.lines.length, 2)
  assert.equal(list.lines[0].status, 'review_required')
  assert.equal(list.lines[0].amount, null)
  assert.equal(list.lines[0].priceCents, null)
  assert.equal(list.lines[1].amount, 200)
})

test('fractional pieces and rounded gram quantities are explicitly review-required', () => {
  const input = withRows([['Ui', 1, 'piece'], ['Kruiden', 1, 'g']])
  const pieces = previewPrivateRecipeShoppingNeeds(input, 3)
  assert.equal(pieces.status, 'needs_review')
  assert.equal(pieces.lines[0].amount, 1.5)
  assert.equal(pieces.lines[0].status, 'review_required')
  const rounded = previewPrivateRecipeShoppingNeeds({...input, servings: 3}, 1)
  assert.equal(rounded.status, 'needs_review')
  assert.equal(rounded.lines[1].amount, 0.333)
  assert.ok(rounded.lines[1].reasons.some((reason) => /afgeronde/.test(reason)))
})

test('missing original servings do not create unproven shopping quantities', () => {
  const input = withRows([['Tomaat', 100, 'g']], null)
  const result = previewPrivateRecipeShoppingNeeds(input, 4)
  assert.equal(result.status, 'needs_review')
  assert.equal(result.lines[0].status, 'review_required')
  assert.ok(result.lines[0].reasons.some((text) => /porties/.test(text)))
})

test('duplicate masses exceeding preview bound fail closed, do not overflow totals', () => {
  const input = withRows([['Kip', 900_000_000, 'g'], ['Kip', 900_000_000, 'g']])
  const result = previewPrivateRecipeShoppingNeeds(input, 2)
  assert.equal(result.status, 'needs_review')
  assert.equal(result.lines.length, 1)
  assert.equal(result.lines[0].amount, null)
  assert.equal(result.lines[0].priceCents, null)
})

test('existing import warning keeps result under review without inventing price', () => {
  const input = withRows([['Kip', 200, 'g']])
  input.warnings = ['Controleer oorspronkelijke portiegrootte']
  const result = previewPrivateRecipeShoppingNeeds(input, 2)
  assert.equal(result.status, 'needs_review')
  assert.equal(result.lines[0].status, 'known_unpriced')
  assert.equal(result.lines[0].priceCents, null)
})
