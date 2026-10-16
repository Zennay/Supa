/**
 * Independent controlled React planner QA on frozen product owner #3300,
 * exact d7a3bad25ad91772110c995903d857ab1d867926.
 * Invalid parent selection input should render review status, not throw.
 * Pure React SSR, no user data, retailer, browser, storage or fetch.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { prepareUnpricedPrivateRecipe } from '../src/features/user-recipes/reviewedRecipeBasketBridge.ts'
import { createPrivateRecipeWeekPreview } from '../src/features/user-recipes/privateWeekPlanner.ts'
import { PrivateRecipeWeekPlanner } from '../src/features/user-recipes/PrivateRecipeWeekPlanner.ts'

function localRecipe() {
  const result = prepareUnpricedPrivateRecipe({
    source: 'manual', sourceUrl: null, title: 'Fictieve pasta',
    status: 'needs_review', servings: 2, minutes: 20, warnings: [],
    steps: ['Roer'], ingredients: [{
      clientId: 'fake-ingredient', original: '200 g pasta',
      label: 'Pasta', query: 'pasta', amount: 200, unit: 'g', reviewReason: null,
    }],
  }, 'synthetic-ui')
  assert.equal(result.status, 'unpriced_ready')
  return result.recipe
}

test('positive: valid empty selection renders an honest waiting state', () => {
  const item = localRecipe()
  const html = renderToStaticMarkup(createElement(PrivateRecipeWeekPlanner, {
    recipes: [item], selection: {}, onSelectionChange() {},
  }))
  assert.match(html, /Kies ten minste één recept/)
  assert.doesNotMatch(html, /€/)
})

for (const selection of [null, undefined]) {
  test('React private week UI must fail closed on ' + String(selection) + ' selection [EXPECTED RED]', () => {
    const item = localRecipe()
    assert.deepEqual(createPrivateRecipeWeekPreview([item], selection),
      { status: 'review_required', reason: 'invalid_selection' })
    const html = renderToStaticMarkup(createElement(PrivateRecipeWeekPlanner, {
      recipes: [item], selection, onSelectionChange() {},
    }))
    assert.match(html, /Controleer de recepten/)
    assert.doesNotMatch(html, /Boodschappen uit mijn recepten/)
    assert.doesNotMatch(html, /€/)
  })
}
