import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as v2Key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

const basket = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: ['Di'],
})
const picked = basket.lines.find((line) => line.status === 'matched')?.id
assert.ok(picked)

test('independent real TSX acceptance: unknown stored versions are never overwritten during first render', async () => {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
  })
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    const { ShoppingListViewV2 } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListViewV2.tsx',
    )
    const raw = JSON.stringify({
      schemaVersion: 3,
      opaqueField: 'synthetic-future-format',
      doneLineIds: [picked],
    })
    const records = new Map([[v2Key, raw]])
    const writes = []
    const port = {
      getItem(key) { return records.get(key) ?? null },
      setItem(key, value) { writes.push([key, value]); records.set(key, value) },
    }

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: port },
    })
    const unknown = renderToStaticMarkup(createElement(ShoppingListViewV2, { basket }))
    assert.match(unknown, /Boodschappenlijst/)
    assert.match(unknown, /0 van \d+ afgevinkt/, 'unknown record cannot resurrect invalid ticks')
    assert.doesNotMatch(unknown, /Opgeslagen boodschappenlijst beschermd/,
      'SSR hydration starts neutral: browser-specific warning appears after effect')
    assert.equal(records.get(v2Key), raw)
    assert.deepEqual(writes, [], 'opening and rendering must never downgrade a future format')

    // A separately rendered recognized v2 record restores only its own ticks.
    records.set(v2Key, serializeShoppingProgressV2(basket, [picked]))
    const recognized = renderToStaticMarkup(createElement(ShoppingListViewV2, { basket }))
    assert.match(recognized, /0 van \d+ afgevinkt/,
      'saved checks are applied after mount, not during initial hydration')
    assert.deepEqual(writes, [])
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
    await vite.close()
  }
})

test('independent real TSX acceptance: absent browser storage does not claim future-record protection', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { ShoppingListViewV2 } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListViewV2.tsx',
    )
    const html = renderToStaticMarkup(createElement(ShoppingListViewV2, { basket }))
    assert.match(html, /Boodschappenlijst/)
    assert.match(html, /0 van \d+ afgevinkt/)
    assert.doesNotMatch(html, /data-storage-state="unknown-record"/)
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
    await vite.close()
  }
})
