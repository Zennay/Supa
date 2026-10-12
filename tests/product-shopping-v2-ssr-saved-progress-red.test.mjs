import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// SSR hydration must start from markup independent of client-only localStorage.
// The browser may restore a saved checklist AFTER mount, not before hydration.
const basket = buildOneStoreBasket({
  store: m2Store,
  products: m2Products,
  recipes: m2Recipes,
  plan: m2InitialPlan,
  activeDays: ['Di'],
})
const checked = basket.lines.find((line) => line.status === 'matched')?.id
assert.ok(checked)

test('shopping-v2 server markup and pre-hydration client markup agree for saved checked progress', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    const { ShoppingListViewV2 } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListViewV2.tsx',
    )
    const render = () => renderToString(createElement(ShoppingListViewV2, { basket }))
    delete globalThis.window
    const serverHtml = render()
    assert.match(serverHtml, /0 van \d+ afgevinkt/)

    const stored = serializeShoppingProgressV2(basket, [checked])
    assert.ok(stored)
    const savedBytes = new Map([[shoppingListProgressV2StorageKey, stored]])
    const writes = []
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem(key) { return savedBytes.get(key) ?? null },
          setItem(key, value) { writes.push([key, value]); savedBytes.set(key, value) },
        },
      },
    })
    const clientHtml = render()
    assert.equal(
      clientHtml, serverHtml,
      'initial client render must not paint saved checkmarks before React hydrates server HTML',
    )
    assert.equal(savedBytes.get(shoppingListProgressV2StorageKey), stored)
    assert.deepEqual(writes, [], 'neither pre-hydration render should write to storage')
  } finally {
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow)
    else delete globalThis.window
    await vite.close()
  }
})

test('shopping-v2 SSR and first render agree with no browser storage', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    const { ShoppingListViewV2 } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListViewV2.tsx',
    )
    delete globalThis.window
    const ssr = renderToString(createElement(ShoppingListViewV2, { basket }))
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: null } })
    const client = renderToString(createElement(ShoppingListViewV2, { basket }))
    assert.equal(client, ssr)
    assert.match(client, /0 van \d+ afgevinkt/)
  } finally {
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow)
    else delete globalThis.window
    await vite.close()
  }
})
