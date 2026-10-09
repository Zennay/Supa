import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  RecipeEstimateDisclosure,
} from '../src/features/planner/RecipeEstimateDisclosure.ts'

test('rendered helper marks fixture values as estimates, never exact store totals', () => {
  const html = renderToStaticMarkup(
    createElement(RecipeEstimateDisclosure, { estimatedCost: 4.5 }),
  )
  assert.match(html, /^<small[^>]+>/)
  assert.match(html, /data-recipe-cost-kind="indicative"/)
  assert.match(html, />Richtprijs:.*\/ recept<\/small>$/)
  assert.match(html, /aria-label="Richtprijs:/)
  assert.match(html, /niet de actuele prijs/)
  assert.doesNotMatch(html, /^<small[^>]*>\s*€/)
  assert.doesNotMatch(html, /bespaard|goedkoper|aanbieding/i)
})

test('rendered helper fails closed without numeric price for bad fixture input', () => {
  for (const value of [NaN, Infinity, -10, 12.555, null, '4,50', 2n]) {
    const html = renderToStaticMarkup(
      createElement(RecipeEstimateDisclosure, { estimatedCost: value }),
    )
    assert.match(html, /data-recipe-cost-kind="unknown"/)
    assert.match(html, /Richtprijs onbekend/)
    assert.doesNotMatch(html, /€/)
  }
})

test('the user-facing amount matches the one accessible to assistive technology', () => {
  const html = renderToStaticMarkup(
    createElement(RecipeEstimateDisclosure, { estimatedCost: 19.69 }),
  )
  assert.match(html, /aria-label="Richtprijs:.*19,69/)
  assert.match(html, />Richtprijs:.*19,69/)
  assert.match(html, /title=".*voorbeeldrecept/)
})
