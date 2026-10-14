import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'

test('real shopping tab fails closed for invalid basket shapes without touching saved checks', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    const { ShoppingListView } = await vite.ssrLoadModule('/src/features/shopping-list/ShoppingListView.tsx')
    const valid = buildOneStoreBasket({
      store: m2Store, recipes: m2Recipes,
      plan: m2InitialPlan, activeDays: ['Di'], products: m2Products,
    })
    const original = structuredClone(valid)
    let storageReads = 0
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        get localStorage() {
          storageReads += 1
          throw Error('PRIVATE_LOCAL_STORAGE_CONTENT_MUST_NOT_BE_READ')
        },
      },
    })

    const sparse = structuredClone(valid)
    sparse.lines = Array(1)
    const corruptMoney = structuredClone(valid)
    const matched = corruptMoney.lines.find((line) => line.status === 'matched')
    assert.ok(matched)
    matched.pricePerPackCents = Number.NaN
    const revoked = Proxy.revocable(valid, {})
    revoked.revoke()
    for (const basket of [sparse, corruptMoney, revoked.proxy, null, undefined]) {
      const html = renderToStaticMarkup(createElement(ShoppingListView, { basket }))
      assert.match(html, /Boodschappenlijst niet beschikbaar/)
      assert.match(html, /Afdrukken is niet beschikbaar/)
      assert.doesNotMatch(html, /Print boodschappenlijst|class="shopping-row|☑|€|<script|PRIVATE_LOCAL_STORAGE/)
    }
    assert.equal(storageReads, 0, 'invalid baskets must not read or overwrite saved checklist bytes')
    assert.deepEqual(valid, original)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete globalThis.window
    await vite.close()
  }
})

test('real shopping tab still prints trusted valid rows and preserves genuine empty-week hint', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { ShoppingListView } = await vite.ssrLoadModule('/src/features/shopping-list/ShoppingListView.tsx')
    const props = {
      store: m2Store, recipes: m2Recipes,
      plan: m2InitialPlan, products: m2Products,
    }
    const valid = buildOneStoreBasket({ ...props, activeDays: ['Di'] })
    const html = renderToStaticMarkup(createElement(ShoppingListView, { basket: valid }))
    assert.match(html, /Print boodschappenlijst/)
    assert.match(html, /class="shopping-row/)
    assert.doesNotMatch(html, /Boodschappenlijst niet beschikbaar/)
    const empty = buildOneStoreBasket({ ...props, activeDays: [] })
    const emptyHtml = renderToStaticMarkup(createElement(ShoppingListView, { basket: empty }))
    assert.match(emptyHtml, /Geen boodschappen voor deze planning/)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete globalThis.window
    await vite.close()
  }
})
