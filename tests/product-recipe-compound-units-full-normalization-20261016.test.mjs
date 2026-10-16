/**
 * Product #3272: fully normalize compound ingredient quantities without
 * silently treating a second numeric measurement as a product label.
 * Offline manual / provided HTML only. No fetch, prices or persistence.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeIngredientLine, createManualRecipeDraft, importRecipeFromHtml,
} from '../src/domain/userRecipeImport.ts'

for (const [raw, expected, unit, label] of [
  ['1 kg 250 g bloem', 1250, 'g', 'bloem'],
  ['1 l 250 ml bouillon', 1250, 'ml', 'bouillon'],
  ['1 lb 4 oz kip', 566.99, 'g', 'kip'],
  ['2 kg 100 gram rijst', 2100, 'g', 'rijst'],
  ['0,5 l 250 ml yoghurt', 750, 'ml', 'yoghurt'],
  ['1 oz 0.5 oz specerijen', 42.524, 'g', 'specerijen'],
]) {
  test('compound input retains both measures: ' + raw, () => {
    const parsed = normalizeIngredientLine(raw)
    assert.equal(parsed.original, raw)
    assert.equal(parsed.label, label)
    assert.equal(parsed.query, label.toLocaleLowerCase('nl'))
    assert.equal(parsed.unit, unit)
    assert.ok(Math.abs(parsed.amount - expected) <= 0.001)
    assert.equal(parsed.reviewReason, null)
  })
}
for (const raw of [
  '1 kg 250 ml bloem',
  '1 l 2 kg soep',
  '1 kg 9999999 g rijst',
  '1 kg 250 g 100 ml bouillon',
]) {
  test('ambiguous or out-of-bounds compound never certifies a partial unit: ' + raw, () => {
    const result = normalizeIngredientLine(raw)
    assert.equal(result.original, raw)
    assert.equal(result.amount, null)
    assert.equal(result.unit, null)
    assert.match(result.reviewReason, /Controleer/)
  })
}
test('manual draft preserves complete normalized quantity and separate regular item', () => {
  const result = createManualRecipeDraft({
    title: 'Fictieve salade', servings: 2, minutes: 20,
    ingredients: ['1 kg 250 g bloem', '200 g kaas'],
    steps: ['Bereid dit fictieve gerecht'],
  })
  assert.equal(result.source, 'manual')
  assert.equal(result.ingredients[0].amount, 1250)
  assert.equal(result.ingredients[0].label, 'bloem')
  assert.equal(result.ingredients[1].amount, 200)
  assert.equal('estimatedCost' in result, false)
  assert.equal(result.status, 'needs_review')
})
test('provided JSON-LD Recipe ingestion does not truncate second liquid measure', () => {
  const recipe = {
    '@context': 'https://schema.org', '@type': 'Recipe',
    name: 'Fictieve soep', recipeYield: '2 porties',
    totalTime: 'PT20M',
    recipeIngredient: ['1 l 250 ml bouillon', '300 g wortels'],
    recipeInstructions: [{ '@type': 'HowToStep', text: 'Fictief koken' }],
  }
  const html = '<script type="application/ld+json">' + JSON.stringify(recipe) + '</script>'
  const draft = importRecipeFromHtml(html, 'https://recipes.example.invalid/soep')
  assert.equal(draft.source, 'url')
  assert.equal(draft.ingredients[0].amount, 1250)
  assert.equal(draft.ingredients[1].amount, 300)
  assert.equal(draft.ingredients[0].label, 'bouillon')
  assert.equal('estimatedCost' in draft, false)
})
for (const [raw, expected, unit] of [
  ['1 kg rijst', 1000, 'g'], ['1 l bouillon', 1000, 'ml'],
  ['250 g wortel', 250, 'g'], ['250 ml yoghurt', 250, 'ml'],
]) {
  test('single unit remains exact: ' + raw, () => {
    const out = normalizeIngredientLine(raw)
    assert.equal(out.amount, expected)
    assert.equal(out.unit, unit)
  })
}
