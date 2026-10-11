import assert from 'node:assert/strict'
import test from 'node:test'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

function basket(products = m2Products, store = m2Store) {
  return buildOneStoreBasket({
    store,
    products,
    activeDays: ['Di'],
    plan: m2InitialPlan,
    recipes: m2Recipes,
  })
}

test('real TSX server render restores checked v2 rows across repricing, not new shopping demand', async () => {
  // Vite transforms the *real TSX module* using the project's existing JSX
  // plugin. No mock component or hand-copied markup is used.
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  })
  const oldWindow = globalThis.window
  const reads = []
  const writes = []
  const data = new Map()
  const fakeStorage = {
    getItem(key) { reads.push(key); return data.get(key) ?? null },
    setItem(key, value) { writes.push([key, value]); data.set(key, value) },
  }

  try {
    const { ShoppingListViewV2 } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListViewV2.tsx',
    )
    const render = (value) => renderToStaticMarkup(
      createElement(ShoppingListViewV2, { basket: value }),
    )

    globalThis.window = { localStorage: fakeStorage }
    const first = basket()
    const firstHtml = render(first)
    assert.match(firstHtml, /Boodschappenlijst/)
    assert.match(firstHtml, /aria-pressed="false"/)
    assert.doesNotMatch(firstHtml, /aria-pressed="true"/)
    assert.deepEqual(writes, [], 'SSR/initial render must not write storage')

    const picked = first.lines.find((line) => line.status === 'matched')
    assert.ok(picked)
    data.set(
      shoppingListProgressV2StorageKey,
      serializeShoppingProgressV2(first, [picked.id]),
    )

    const repriced = basket(m2Products.map((product) =>
      product.id === picked.productId
        ? { ...product, priceCents: product.priceCents + 19 }
        : product,
    ))
    assert.notEqual(first.totalCents, repriced.totalCents)
    const afterPriceChange = render(repriced)
    assert.match(afterPriceChange, /aria-pressed="true"/)
    assert.match(afterPriceChange, /Boodschappenlijst/)
    assert.deepEqual(writes, [], 'restoring must never write during render')
    assert.ok(reads.every((key) => key === shoppingListProgressV2StorageKey))

    const changedStore = basket(m2Products, { ...m2Store, id: 'another-store' })
    assert.doesNotMatch(render(changedStore), /aria-pressed="true"/)

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        get localStorage() { throw new Error('blocked by privacy mode') },
      },
    })
    assert.doesNotThrow(() => render(repriced))
    assert.deepEqual(writes, [])
  } finally {
    if (oldWindow === undefined) delete globalThis.window
    else globalThis.window = oldWindow
    await vite.close()
  }
})
