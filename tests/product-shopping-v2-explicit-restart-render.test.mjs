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

const basket = (store = m2Store, products = m2Products) => buildOneStoreBasket({
  store,
  products,
  activeDays: ['Di'],
  plan: m2InitialPlan,
  recipes: m2Recipes,
})

test('the real shopping-v2 TSX offers a deliberate accessible clear action only for valid checked rows', async () => {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const items = new Map()
  const writes = []
  const storage = {
    getItem(key) { return items.get(key) ?? null },
    setItem(key, value) { writes.push([key, value]); items.set(key, value) },
  }

  try {
    const { ShoppingListViewV2 } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListViewV2.tsx',
    )
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: storage },
    })
    const render = (value) => renderToStaticMarkup(
      createElement(ShoppingListViewV2, { basket: value }),
    )

    const first = basket()
    const picked = first.lines.find((line) => line.status === 'matched')
    assert.ok(picked)
    const fresh = render(first)
    assert.doesNotMatch(fresh, /Vinkjes wissen/)
    assert.match(fresh, /0 van \d+ afgevinkt/)

    items.set(shoppingListProgressV2StorageKey, serializeShoppingProgressV2(first, [picked.id]))
    const restored = render(first)
    assert.match(restored, /<button[^>]*class="ghost-button"[^>]*type="button"[^>]*>Vinkjes wissen<\/button>/)
    assert.match(restored, /1 van \d+ afgevinkt/)
    const repriced = basket(m2Store, m2Products.map((product) => ({
      ...product, priceCents: product.priceCents + 4,
    })))
    assert.match(render(repriced), /Vinkjes wissen/, 'price-only changes retain the affordance')

    const differentStore = basket({ ...m2Store, id: 'synthetic-new-store' })
    assert.doesNotMatch(render(differentStore), /Vinkjes wissen/)
    assert.doesNotMatch(render({ ...first, lines: [null] }), /Vinkjes wissen/)
    assert.doesNotMatch(render({ ...first, lines: [] }), /Vinkjes wissen/)

    items.set(shoppingListProgressV2StorageKey, JSON.stringify({
      schemaVersion: 2, demandIdentity: 'synthetic-foreign-demand', doneLineIds: [picked.id],
    }))
    assert.doesNotMatch(render(first), /Vinkjes wissen/,
      'untrusted persisted progress cannot reveal a destructive action')
    assert.deepEqual(writes, [], 'SSR and initial render must never persist clear or checked state')
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor)
    else delete globalThis.window
    await vite.close()
  }
})
