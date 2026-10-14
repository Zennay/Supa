import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { m2Recipes } from '../src/data/m2Fixture.ts'
import { RecipePriceExplanation } from '../src/features/planner/RecipePriceExplanation.ts'
import { recipeEstimatePresentation } from '../src/features/planner/recipeEstimatePresentation.ts'

function rendered(value) {
  return renderToStaticMarkup(createElement(RecipePriceExplanation, { estimatedCost: value }))
}

test('actual routed Planner disclosure uses the shared cent-valid estimate label for every controlled recipe', () => {
  for (const recipe of m2Recipes) {
    const presentation = recipeEstimatePresentation(recipe.estimatedCost)
    const html = rendered(recipe.estimatedCost)
    assert.equal(presentation.kind, 'indicative')
    assert.ok(html.includes(presentation.label))
    assert.match(html, /data-estimate-status="indicative"/)
    assert.match(html, /<details><summary>Waarom een richtprijs\?<\/summary>/)
    assert.match(html, /voorbeeldschatting, niet de actuele supermarktprijs/)
    assert.doesNotMatch(html, /title=|aria-hidden|data-public-savings-claim/)
  }
})

test('actual routed Planner and optional presentation agree on malformed, unknown and edge cent amounts', () => {
  for (const value of [
    0, 0.01, 3.5, 19.69, 999.99, -1, NaN, Infinity, -Infinity,
    1.005, Number.MAX_VALUE, '3.25', null, undefined, {}, [], 2n,
  ]) {
    const presentation = recipeEstimatePresentation(value)
    const html = rendered(value)
    assert.ok(html.includes(presentation.label))
    assert.ok(html.includes(`data-estimate-status="${presentation.kind}"`))
    if (presentation.kind === 'unknown') {
      assert.doesNotMatch(html, /€/)
      assert.match(html, /<summary>Waarom geen richtprijs\?<\/summary>/)
    } else {
      assert.match(html, /<summary>Waarom een richtprijs\?<\/summary>/)
    }
    assert.equal((html.match(/<details>/g) ?? []).length, 1)
    assert.doesNotMatch(html, /Besparing|bespaard|live prijs|bespaart/)
  }
})
