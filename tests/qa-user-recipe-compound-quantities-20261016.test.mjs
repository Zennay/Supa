/**
 * Independent SUPA quality-validation for #3263, based on immutable manual /
 * JSON-LD recipe import product owner #3264 at
 * 6d07fb55db29e38270500c5c11d036626072eb05.
 *
 * A compound quantity must be either fully normalized to g/ml or explicitly
 * left unresolved for review. Silently keeping only the first quantity is a
 * wrong food amount and can distort an eventual shopping list or budget.
 *
 * No network requests, database writes, retailer prices or customer data.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeIngredientLine, importRecipeFromHtml, createManualRecipeDraft,
} from '../src/domain/userRecipeImport.ts'

function exactOrReview(item, expectedAmount, expectedUnit) {
  assert.equal(item.status, undefined, 'ingredient alone must not grant recipe approval')
  assert.equal('estimatedCost' in item, false)
  if (item.amount === null) {
    assert.equal(item.unit, null)
    assert.ok(typeof item.reviewReason === 'string' && item.reviewReason.length > 0,
      'unresolved quantity must be explicitly marked for review')
    return
  }
  assert.equal(item.unit, expectedUnit)
  assert.ok(Math.abs(item.amount - expectedAmount) <= 0.001,
    'a compound measure must not silently drop its second quantity')
  assert.equal(item.reviewReason, null)
  assert.doesNotMatch(item.label, /^\s*\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|oz)\b/i,
    'a dropped second measurement must not be mislabeled as a food name')
}

test('manual mixed metric mass: 1 kg + 250 g is 1250 g or requires human review', () => {
  const ingredient = normalizeIngredientLine('1 kg 250 g bloem')
  assert.equal(ingredient.original, '1 kg 250 g bloem')
  exactOrReview(ingredient, 1250, 'g')
})

test('manual mixed metric liquid: 1 l + 250 ml is 1250 ml or requires human review', () => {
  const ingredient = normalizeIngredientLine('1 l 250 ml bouillon')
  assert.equal(ingredient.original, '1 l 250 ml bouillon')
  exactOrReview(ingredient, 1250, 'ml')
})

test('manual imperial mixed mass: 1 lb + 4 oz is approximately 566.990 g or requires review', () => {
  const ingredient = normalizeIngredientLine('1 lb 4 oz kip')
  assert.equal(ingredient.original, '1 lb 4 oz kip')
  exactOrReview(ingredient, 566.99, 'g')
})

test('manual recipe draft must not certify a partially parsed compound ingredient as review-complete', () => {
  const draft = createManualRecipeDraft({
    title: 'Fictieve maaltijd',
    servings: 2,
    minutes: 20,
    ingredients: ['1 kg 250 g bloem', '200 g kaas'],
    steps: ['Bereid de ingrediënten'],
  })
  assert.equal(draft.status, 'needs_review')
  assert.equal('estimatedCost' in draft, false)
  exactOrReview(draft.ingredients[0], 1250, 'g')
  assert.equal(draft.ingredients[1].amount, 200)
  assert.equal(draft.ingredients[1].unit, 'g')
  if (draft.ingredients[0].amount === null) {
    assert.ok(draft.warnings.some(w => /Ingrediënt 1/.test(w)),
      'the preview must surface why the incomplete compound amount needs review')
  }
})

test('already-fetched JSON-LD importer must not quietly certify a partial metric quantity', () => {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: 'Fictieve groentesoep',
    recipeYield: '2 porties',
    totalTime: 'PT20M',
    recipeIngredient: ['1 l 250 ml bouillon', '300 g wortels'],
    recipeInstructions: [{ '@type': 'HowToStep', text: 'Roer alles.' }],
  }
  const html = '<script type="application/ld+json">' +
    JSON.stringify(schema) + '</script>'
  const draft = importRecipeFromHtml(html, 'https://recipes.example.invalid/soep')
  assert.equal(draft.source, 'url')
  assert.equal(draft.status, 'needs_review')
  assert.equal('estimatedCost' in draft, false)
  exactOrReview(draft.ingredients[0], 1250, 'ml')
  assert.equal(draft.ingredients[1].amount, 300)
  if (draft.ingredients[0].amount === null) {
    assert.ok(draft.warnings.some(w => /Ingrediënt 1/.test(w)))
  }
})

test('single canonical metric lines remain usable and exact', () => {
  for (const [source, amount, unit] of [
    ['1 kg rijst', 1000, 'g'],
    ['250 g wortel', 250, 'g'],
    ['1 l bouillon', 1000, 'ml'],
    ['250 ml yoghurt', 250, 'ml'],
  ]) {
    const ingredient = normalizeIngredientLine(source)
    assert.equal(ingredient.amount, amount, source)
    assert.equal(ingredient.unit, unit, source)
    assert.equal(ingredient.reviewReason, null, source)
  }
})
