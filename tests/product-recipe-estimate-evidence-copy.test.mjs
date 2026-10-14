import assert from 'node:assert/strict'
import test from 'node:test'

import { m2Recipes } from '../src/data/m2Fixture.ts'
import { euro } from '../src/lib/money.ts'
import {
  recipeEstimatePresentation,
} from '../src/features/planner/recipeEstimatePresentation.ts'

test('fixture prices are always explicitly indicative rather than observed costs', () => {
  for (const recipe of m2Recipes) {
    const result = recipeEstimatePresentation(recipe.estimatedCost)
    assert.equal(result.kind, 'indicative')
    assert.equal(result.label, `Richtprijs: ${euro.format(recipe.estimatedCost)} / recept`)
    assert.match(result.explanation, /voorbeeldrecept/)
    assert.match(result.explanation, /niet de actuele prijs/)
    assert.ok(!result.label.startsWith('€'))
    assert.ok(!result.label.includes('Besparing'))
  }
})

test('zero and cent-exact illustrative prices are marked as estimates', () => {
  assert.deepEqual(recipeEstimatePresentation(0), {
    kind: 'indicative',
    label: `Richtprijs: ${euro.format(0)} / recept`,
    explanation:
      'Dit is een richtprijs uit het voorbeeldrecept, niet de actuele prijs van een berekende winkelmand.',
  })
  assert.equal(
    recipeEstimatePresentation(4.5).label,
    `Richtprijs: ${euro.format(4.5)} / recept`,
  )
  assert.equal(
    recipeEstimatePresentation(19.69).label,
    `Richtprijs: ${euro.format(19.69)} / recept`,
  )
})

test('invalid and inexact money never appears as a plausible numeric recipe price', () => {
  for (const value of [
    -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
    4.555, Number.MAX_VALUE, '4.50', null, undefined, {}, [], 3n,
  ]) {
    const result = recipeEstimatePresentation(value)
    assert.equal(result.kind, 'unknown', String(value))
    assert.equal(result.label, 'Richtprijs onbekend')
    assert.match(result.explanation, /niet.*richtprijs|geen betrouwbare richtprijs/i)
    assert.ok(!result.label.includes('€'))
  }
})

test('presentation is pure and cannot convert estimates into basket claims', () => {
  const original = m2Recipes.map(({ id, estimatedCost }) => ({ id, estimatedCost }))
  const outputs = original.map(({ estimatedCost }) =>
    recipeEstimatePresentation(estimatedCost),
  )
  assert.deepEqual(
    m2Recipes.map(({ id, estimatedCost }) => ({ id, estimatedCost })),
    original,
  )
  assert.equal(outputs.length, original.length)
  assert.ok(outputs.every((item) => !item.label.includes('mandtotaal')))
  assert.ok(outputs.every((item) => !item.label.includes('actuele winkelprijs')))
})
