import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import {
  shoppingListProgressStorageKey,
  serializeShoppingListProgress,
  restoreShoppingListProgress,
} from '../src/features/shopping-list/shoppingListProgress.ts'

// Independent QA of PR #1849. Render the ACTUAL mounted v1 view instead of
// importing its unexported formatting helper; all data are M2 demo fixtures.
test('qa: Dutch shopping text preserves restored v1 checkmarks and storage boundaries', async () => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const existingWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    const { ShoppingListView } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListView.tsx',
    )
    const basket = buildOneStoreBasket({
      store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
      activeDays: ['Ma'], products: m2Products,
    })
    const piece = basket.lines.find(line =>
      line.status === 'matched' && line.pack.unit === 'piece',
    )
    assert.ok(piece, 'demo basket must include a real matched piece pack')
    const before = structuredClone(basket)
    const stored = serializeShoppingListProgress(basket, [piece.id])
    assert.deepEqual(restoreShoppingListProgress(basket, stored), [piece.id])
    let reads = 0
    let writes = 0
    globalThis.window = {
      localStorage: {
        getItem(key) {
          assert.equal(key, shoppingListProgressStorageKey)
          reads++
          return stored
        },
        setItem() { writes++; throw new Error('SSR must not write') },
      },
    }
    const html = renderToStaticMarkup(createElement(ShoppingListView, { basket }))
    assert.match(html, /class="shopping-row checked"/)
    assert.match(html, /1 × 1 stuk/)
    assert.doesNotMatch(html, /\bpiece\b|\bunknown\b/)
    assert.ok(reads > 0, 'the existing v1 persisted check state was read')
    assert.equal(writes, 0, 'server rendering must not mutate local storage')
    assert.deepEqual(basket, before, 'formatting must not alter canonical demand')

    // A denied private-mode read cannot remove the displayed groceries or
    // leak English canonical units into the localized view.
    globalThis.window = {
      get localStorage() { throw new Error('denied by browser') },
    }
    const privateHtml = renderToStaticMarkup(createElement(ShoppingListView, { basket }))
    assert.match(privateHtml, /1 × 1 stuk/)
    assert.doesNotMatch(privateHtml, /class="shopping-row checked"/)
    assert.deepEqual(basket, before)
  } finally {
    if (existingWindow) Object.defineProperty(globalThis, 'window', existingWindow)
    else delete globalThis.window
    await vite.close()
  }
})
