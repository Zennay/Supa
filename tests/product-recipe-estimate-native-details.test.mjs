import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { m2Recipes } from '../src/data/m2Fixture.ts'
import { RecipeEstimateDetails } from '../src/features/planner/RecipeEstimateDetails.ts'
import { recipeEstimatePresentation } from '../src/features/planner/recipeEstimatePresentation.ts'

function renderEstimate(value) {
  return renderToStaticMarkup(
    createElement(RecipeEstimateDetails, { estimatedCost: value }),
  )
}

test('fixture recipe estimate has visible indicative money and native expandable explanation', () => {
  for (const recipe of m2Recipes) {
    const html = renderEstimate(recipe.estimatedCost)
    const expected = recipeEstimatePresentation(recipe.estimatedCost)
    assert.match(html, /data-recipe-estimate-kind="indicative"/)
    assert.match(html, /<small[^>]*>Richtprijs:/)
    assert.match(html, /<details[^>]*><summary>Waarom een richtprijs\?<\/summary>/)
    assert.ok(html.includes('niet de actuele prijs'), recipe.id)
    assert.ok(html.includes('voorbeeldrecept'), recipe.id)
    assert.ok(html.includes('Richtprijs:'), recipe.id)
    assert.ok(html.includes(expected.label.split(' / recept')[0].replace(/&/g, '&amp;')), recipe.id)
    assert.doesNotMatch(html, /<button\b[^>]*>|on(?:click|keydown)=/i)
    assert.doesNotMatch(html, /<summary[^>]+tabindex="-1"/)
  }
})

test('unknown and unsafe fixture costs remain unpriced with an actionable disclosure', () => {
  for (const bad of [-1, NaN, Infinity, -Infinity, 4.555, Number.MAX_VALUE, '4.50', null, undefined, {}, []]) {
    const html = renderEstimate(bad)
    assert.match(html, /data-recipe-estimate-kind="unknown"/)
    assert.match(html, /<small[^>]*>Richtprijs onbekend<\/small>/)
    assert.match(html, /<details[^>]*><summary>Waarom geen richtprijs\?<\/summary>/)
    assert.match(html, /geen betrouwbare richtprijs/)
    assert.doesNotMatch(html, /€|Besparing|bespaard/)
  }
})

test('zero and cent-exact examples retain their indicative label, never claim retailer proof', () => {
  for (const value of [0, 0.01, 3.5, 19.69]) {
    const html = renderEstimate(value)
    assert.match(html, /Richtprijs:/)
    assert.match(html, /<summary>Waarom een richtprijs\?<\/summary>/)
    assert.match(html, /niet de actuele prijs/)
    assert.doesNotMatch(html, /<output|data-public-savings-claim|<strong>Besparing/)
  }
})

test('native disclosure is a semantic sibling of price text, not a hover-only title', () => {
  const html = renderEstimate(19.69)
  assert.match(
    html,
    /^<div class="recipe-estimate-explanation" data-recipe-estimate-kind="indicative"><small[^>]*>[^<]+<\/small><details[^>]*><summary>[^<]+<\/summary><p>[^<]+<\/p><\/details><\/div>$/,
  )
  assert.doesNotMatch(html, /title=|aria-hidden="true"|style="display:none"/)
  assert.equal((html.match(/<details/g) ?? []).length, 1)
  assert.equal((html.match(/<summary/g) ?? []).length, 1)
})
