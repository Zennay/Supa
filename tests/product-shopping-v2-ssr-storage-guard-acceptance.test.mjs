import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { serializeShoppingListProgress, shoppingListProgressStorageKey } from '../src/features/shopping-list/shoppingListProgress.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'

// Separate, test-only privacy/compatibility cases for the staged v2 SSR fix.
// Actual React first render, synthetic M2 groceries; no live browser claims.
test('shopping-v2 SSR remains neutral for denied storage and explicit v1 upgrade', async () => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    const { ShoppingListViewV2 } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListViewV2.tsx',
    )
    const basket = buildOneStoreBasket({
      plan: m2InitialPlan,
      activeDays: m2InitialPlan.map((row) => row.day),
      products: m2Products,
      recipes: m2Recipes,
      store: m2Store,
    })
    const selected = basket.lines.find((line) => line.status === 'matched')?.id
    assert.ok(selected)
    const v1 = serializeShoppingListProgress(basket, [selected])
    const html = () => renderToString(createElement(ShoppingListViewV2, {
      basket, allowLegacyUpgrade: true,
    }))

    delete globalThis.window
    const server = html()
    assert.match(server, /0 van \d+ afgevinkt/)
    assert.doesNotMatch(server, /aria-pressed="true"/)

    // Private browsing may expose window while throwing on localStorage access.
    let accessed = 0
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { get localStorage() { accessed++; throw new Error('denied') } },
    })
    assert.equal(html(), server)
    assert.equal(accessed, 1)

    // A denied initial v2 read must neither attempt a v1 import nor write.
    const failedReads = []
    let writes = 0
    const denied = {
      getItem(key) { failedReads.push(key); throw new Error('read denied') },
      setItem() { writes++ },
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true, value: { localStorage: denied },
    })
    assert.equal(html(), server)
    assert.deepEqual(failedReads, [shoppingListProgressV2StorageKey])
    assert.equal(writes, 0)

    // Existing unknown v3 bytes must take precedence over explicit v1 consent.
    // Never interpret v3 as "missing" and silently read/upgrade the v1 key.
    const future = '{"schemaVersion":3,"protected":true}'
    const bytes = new Map([
      [shoppingListProgressV2StorageKey, future],
      [shoppingListProgressStorageKey, v1],
    ])
    const reads = []
    const storage = {
      getItem(key) { reads.push(key); return bytes.get(key) ?? null },
      setItem() { writes++; throw new Error('render must not write') },
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true, value: { localStorage: storage },
    })
    assert.equal(html(), server)
    assert.deepEqual(reads, [shoppingListProgressV2StorageKey])
    assert.equal(writes, 0)
    assert.equal(bytes.get(shoppingListProgressV2StorageKey), future)
    assert.equal(bytes.get(shoppingListProgressStorageKey), v1)

    // Explicit opt-in may *read* an absent-v2 legacy checklist during render,
    // but its checked state must be applied only after mount, never in SSR HTML.
    bytes.delete(shoppingListProgressV2StorageKey)
    reads.length = 0
    assert.equal(html(), server)
    assert.deepEqual(reads, [shoppingListProgressV2StorageKey, shoppingListProgressStorageKey])
    assert.equal(writes, 0)
    assert.deepEqual(
      openShoppingProgressStorageV2(basket, storage, { allowLegacyUpgrade: true })
        .snapshot().completedLineIds,
      [selected],
      'neutral first paint must preserve explicit legacy restoration',
    )
    assert.equal(bytes.has(shoppingListProgressV2StorageKey), false)
    assert.equal(bytes.get(shoppingListProgressStorageKey), v1)
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
    await vite.close()
  }
})
