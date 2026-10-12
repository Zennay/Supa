import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'

// Follow-up for the *currently routed* v1 ShoppingListView on frozen
// product/v1-shopping-nl-quantity-review-20261012. Only synthetic M2 data.
test('product: unresolved piece demand is readable Dutch at each quantity without inventing a product', async () => {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const existingWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { ShoppingListView } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListView.tsx',
    )
    const original = buildOneStoreBasket({
      store: m2Store, products: m2Products, plan: m2InitialPlan,
      activeDays: ['Di'], recipes: m2Recipes,
    })
    const unresolvedScenarios = [
      { amount: 1, unit: 'piece', expected: '1 stuk · handmatig kiezen' },
      { amount: 2, unit: 'piece', expected: '2 stuks · handmatig kiezen' },
      { amount: null, unit: 'piece', expected: '? stuks · handmatig kiezen' },
      { amount: null, unit: 'unknown', expected: '? onbekend · handmatig kiezen' },
      { amount: 0.5, unit: 'kg', expected: '0.5 kg · handmatig kiezen' },
    ]

    for (const { amount, unit, expected } of unresolvedScenarios) {
      const line = {
        id: 'synthetic-ingredient-choice',
        ingredientLabel: 'Ingrediënt zonder betrouwbare winkelmatch',
        status: 'unresolved',
        requirement: { amount, unit },
        reasons: ['synthetic: no matched product'],
        matchScore: null,
      }
      const basket = {
        ...original, lines: [line],
        matchedLineCount: 0, unresolvedLineCount: 1,
      }
      const before = structuredClone(basket)
      const html = renderToStaticMarkup(createElement(ShoppingListView, { basket }))
      assert.ok(html.includes(expected), `${unit} ${amount}: missing Dutch label: ${html}`)
      assert.match(html, /SUPA vult een onzekere match niet automatisch in/)
      assert.match(html, /Ingrediënt zonder betrouwbare winkelmatch/)
      assert.doesNotMatch(html, /\\bpiece\\b|\\bunknown\\b/)
      assert.deepEqual(basket, before, 'render must not mutate demand or source units')
      assert.equal(basket.lines[0].requirement.unit, unit)
    }
  } finally {
    if (existingWindow) Object.defineProperty(globalThis, 'window', existingWindow)
    else delete globalThis.window
    await vite.close()
  }
})
