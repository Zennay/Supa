import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'

test('real App-routed v1 shopping list exposes basket-scoped status without financial claims', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const source = await readFile(new URL('../src/features/shopping-list/ShoppingListView.tsx', import.meta.url), 'utf8')
  assert.match(app, /ShoppingListView basket=\{basket\}/)
  assert.match(source, /<ShoppingListCompletionBanner basket=\{basket\} doneLineIds=\{done\} \/>/)

  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { ShoppingListView } = await vite.ssrLoadModule('/src/features/shopping-list/ShoppingListView.tsx')
    const basket = buildOneStoreBasket({
      store: m2Store,
      products: m2Products,
      recipes: m2Recipes,
      plan: m2InitialPlan,
      activeDays: ['Di'],
    })
    assert.ok(basket.lines.length > 0)
    const input = structuredClone(basket)
    const html = renderToStaticMarkup(createElement(ShoppingListView, { basket }))
    assert.match(html, /data-shopping-progress-state="in-progress"/)
    assert.match(html, /role="status"/)
    assert.match(html, /van .* boodschappen? afgevinkt/)
    assert.match(html, /class="shopping-row/)
    assert.doesNotMatch(html, /claimable|besparing|live prijs|€/)
    assert.deepEqual(basket, input)
    const emptyBasket = buildOneStoreBasket({
      store: m2Store,
      products: m2Products,
      recipes: m2Recipes,
      plan: m2InitialPlan,
      activeDays: [],
    })
    const empty = renderToStaticMarkup(createElement(ShoppingListView, { basket: emptyBasket }))
    assert.match(empty, /Geen boodschappen voor deze planning/)
    assert.doesNotMatch(empty, /data-shopping-progress-state=/)
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
    await vite.close()
  }
})
