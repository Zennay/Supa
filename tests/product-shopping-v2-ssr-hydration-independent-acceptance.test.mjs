import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { shoppingListProgressStorageKey } from '../src/features/shopping-list/shoppingListProgress.ts'

// Independent postrepair acceptance: actual TSX first render on the canonical
// four-meal M2 week. All stored records are synthetic, never real participant
// progress, supermarket observations, or field evidence.
function week(products = m2Products, store = m2Store) {
  return buildOneStoreBasket({
    plan: m2InitialPlan,
    activeDays: m2InitialPlan.map((row) => row.day),
    products, recipes: m2Recipes, store,
  })
}

test('v2 first paint matches SSR for checked, repriced, foreign, legacy and protected storage', async () => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    const { ShoppingListViewV2 } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListViewV2.tsx',
    )
    const original = week()
    const ids = original.lines.filter((row) => row.status === 'matched')
      .slice(0, 2).map((row) => row.id)
    assert.equal(ids.length, 2)
    const repriced = week(m2Products.map((p) => ({ ...p, priceCents: p.priceCents + 3 })))
    const foreign = week(m2Products, { ...m2Store, id: 'unrelated-demo-shop' })
    const storedV2 = serializeShoppingProgressV2(original, ids)
    assert.ok(storedV2)

    const html = (basket) => renderToString(createElement(ShoppingListViewV2, { basket }))
    delete globalThis.window
    const ssrBase = html(original)
    const ssrRepriced = html(repriced)
    const ssrForeign = html(foreign)
    assert.match(ssrBase, /Boodschappenlijst/)
    assert.doesNotMatch(ssrBase, /aria-pressed="true"/)

    const data = new Map()
    const writes = []
    const storage = {
      getItem(key) { return data.get(key) ?? null },
      setItem(key, value) { writes.push([key, value]); data.set(key, value) },
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true, value: { localStorage: storage },
    })

    for (const [label, v2, v1, basket, expected] of [
      ['two real v2 checks', storedV2, null, original, ssrBase],
      ['same physical basket with price refresh', storedV2, null, repriced, ssrRepriced],
      ['foreign physical basket', storedV2, null, foreign, ssrForeign],
      ['unknown future record', JSON.stringify({ schemaVersion: 3, unknown: true }), null, original, ssrBase],
      ['legacy v1 only', null, '{"schemaVersion":1,"synthetic":true}', original, ssrBase],
      ['no durable record', null, null, original, ssrBase],
    ]) {
      data.clear()
      if (v2 !== null) data.set(shoppingListProgressV2StorageKey, v2)
      if (v1 !== null) data.set(shoppingListProgressStorageKey, v1)
      assert.equal(html(basket), expected, label + ': client first paint differs from server')
      assert.deepEqual(writes, [], label + ': first paint wrote to storage')
      assert.equal(data.get(shoppingListProgressV2StorageKey) ?? null, v2)
      assert.equal(data.get(shoppingListProgressStorageKey) ?? null, v1)
    }

    data.clear()
    data.set(shoppingListProgressV2StorageKey, storedV2)
    assert.deepEqual(
      openShoppingProgressStorageV2(repriced, storage).snapshot().completedLineIds,
      ids,
      'hydration-safe presentation must not lose the actual saved checks',
    )
    assert.deepEqual(
      openShoppingProgressStorageV2(foreign, storage).snapshot().completedLineIds,
      [],
      'a different store must still refuse imported completion',
    )
    assert.deepEqual(writes, [], 'independent restoration checks must not auto-save')
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
    await vite.close()
  }
})
