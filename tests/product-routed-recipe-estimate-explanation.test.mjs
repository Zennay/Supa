import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RecipePriceExplanation } from '../src/features/planner/RecipePriceExplanation.ts'
import { m2Recipes } from '../src/data/m2Fixture.ts'

function render(value) {
  return renderToStaticMarkup(createElement(RecipePriceExplanation, { estimatedCost: value }))
}

test('routed Planner shows the design per-serving estimate, labelled as an example estimate', async () => {
  const planner = await readFile(new URL('../src/features/planner/PlannerView.tsx', import.meta.url), 'utf8')
  // Exact cents per serving, or nothing for an invalid/inexact estimate.
  assert.match(planner, /function servingEstimateCents\(recipe: Recipe\): number \| null/)
  assert.match(planner, /if \(cents \/ 100 !== cost\) return null/)
  assert.match(planner, /title="Richtprijs uit het voorbeeldrecept, geen actuele winkelprijs"/)
  assert.doesNotMatch(planner, /euro\.format\(recipe\.estimatedCost\)/)
})

test('controlled catalog prices remain visibly indicative and have a native accessible disclosure', () => {
  for (const recipe of m2Recipes) {
    const html = render(recipe.estimatedCost)
    assert.match(html, /data-estimate-status="indicative"/)
    assert.match(html, /Richtprijs:/)
    assert.match(html, /<details><summary>Waarom een richtprijs\?<\/summary>/)
    assert.match(html, /voorbeeldschatting, niet de actuele supermarktprijs/)
    assert.doesNotMatch(html, /<button|title=|aria-hidden|data-public-savings-claim/)
  }
})

test('invalid, inexact, and deceptive example prices abstain instead of displaying euros', () => {
  for (const cost of [-1, NaN, Infinity, -Infinity, 1.005, Number.MAX_VALUE, '3.25', null, undefined, {}, []]) {
    const html = render(cost)
    assert.match(html, /data-estimate-status="unknown"/)
    assert.match(html, /Richtprijs onbekend/)
    assert.match(html, /<summary>Waarom geen richtprijs\?<\/summary>/)
    assert.doesNotMatch(html, /€|Besparing|bespaard/)
  }
})

test('exact cents render without extra invented precision or savings statements', () => {
  for (const price of [0, 0.01, 3.5, 19.69]) {
    const html = render(price)
    assert.match(html, /data-estimate-status="indicative"/)
    assert.match(html, /Richtprijs:/)
    assert.doesNotMatch(html, /Besparing|bespaard|live prijs|bespaart/)
    assert.equal((html.match(/<details>/g) ?? []).length, 1)
    assert.equal((html.match(/<summary>/g) ?? []).length, 1)
  }
})
