import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'

// Current App.tsx is routed to ShoppingListView v1, NOT review-only v2.
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
test('product v1: the active App still routes shopping to the reviewed v1 component', () => {
  assert.match(appSource, /import\s*\{\s*ShoppingListView\s*\}\s*from\s*['"]\.\/features\/shopping-list\/ShoppingListView['"]/)
  assert.match(appSource, /tab === 'list'[^\n]*ShoppingListView basket=\{basket\}/)
})

// Real Vite-transformed React component and deterministic M2 basket. This is
// synthetic SSR, not persistent browser, retailer or real-world savings proof.
test('product v1: a genuinely empty week is explained while inconsistent zero-row baskets fail closed', async () => {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { ShoppingListView } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListView.tsx',
    )
    const render = basket => renderToStaticMarkup(
      createElement(ShoppingListView, { basket }),
    )
    const empty = buildOneStoreBasket({
      store: m2Store, products: m2Products,
      plan: m2InitialPlan, recipes: m2Recipes, activeDays: [],
    })
    assert.equal(empty.lines.length, 0)
    assert.equal(empty.selectedMealCount, 0)
    assert.equal(empty.matchedLineCount, 0)
    assert.equal(empty.unresolvedLineCount, 0)
    assert.equal(empty.totalCents, 0)

    const before = structuredClone(empty)
    const html = render(empty)
    assert.match(html, /role="status"/)
    assert.match(html, /Geen boodschappen voor deze planning/)
    assert.match(html, /Voeg een maaltijd toe in Planner/)
    assert.doesNotMatch(html, /Boodschappenlijst niet beschikbaar/)
    assert.doesNotMatch(html, /class="shopping-row/)
    assert.deepEqual(empty, before, 'SSR must not mutate the canonical empty basket')

    for (const [name, change] of [
      ['selected meals', { selectedMealCount: 1 }],
      ['matched counter', { matchedLineCount: 1 }],
      ['unresolved counter', { unresolvedLineCount: 1 }],
      ['unexpected money', { totalCents: 1 }],
      ['nonfinite money', { totalCents: Number.NaN }],
      ['negative selection', { selectedMealCount: -1 }],
    ]) {
      const inconsistent = { ...empty, ...change }
      const original = structuredClone(inconsistent)
      const warning = render(inconsistent)
      assert.match(warning, /role="status"/, name)
      assert.match(warning, /Boodschappenlijst niet beschikbaar/, name)
      assert.match(warning, /Controleer je planning/, name)
      assert.doesNotMatch(warning, /Geen boodschappen voor deze planning/, name)
      assert.doesNotMatch(warning, /class="shopping-row/, name)
      assert.deepEqual(inconsistent, original, name + ': no input mutation')
    }
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
    await vite.close()
  }
})

test('product v1: normal planned M2 products still show checkable rows and no false empty warning', async () => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { ShoppingListView } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListView.tsx',
    )
    const basket = buildOneStoreBasket({
      store: m2Store, products: m2Products,
      plan: m2InitialPlan, recipes: m2Recipes, activeDays: ['Di'],
    })
    assert.ok(basket.lines.length > 0)
    const prior = structuredClone(basket)
    const html = renderToStaticMarkup(createElement(ShoppingListView, { basket }))
    assert.match(html, /class="shopping-row/)
    assert.doesNotMatch(html, /Geen boodschappen voor deze planning/)
    assert.doesNotMatch(html, /Boodschappenlijst niet beschikbaar/)
    assert.deepEqual(basket, prior)
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
    await vite.close()
  }
})
