import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

const basket = () => buildOneStoreBasket({
  store: m2Store, products: m2Products, plan: m2InitialPlan,
  activeDays: ['Di'], recipes: m2Recipes,
})

test('review-only v2 UI recovery stays explicit for failed saves and protected records, never on normal render', async () => {
  const source = readFileSync(
    new URL('../src/features/shopping-list/ShoppingListViewV2.tsx', import.meta.url), 'utf8',
  )
  assert.match(source, /function reloadSaved\(\)/)
  assert.match(source, /controller\.reloadSaved\(\{ requireSameDemand: unknownStoredRecord \}\)/)
  assert.match(source, /\{unknownStoredRecord && \(/)
  assert.match(source, /onClick=\{reloadSaved\}/)
  assert.match(source, /type="button" className="ghost-button" onClick=\{reloadSaved\}/)
  assert.match(source, /Niet-opgeslagen vinkjes verdwijnen als het laden lukt\./)
  assert.match(source, /\{saveFailed && \(/)
  assert.doesNotMatch(
    source, /useEffect\(\(\) => \{\s*controller\.reloadSaved\(/,
    'recovery is never an automatic effect',
  )

  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const values = new Map()
  const writes = []
  const storage = {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { writes.push([key, value]); values.set(key, value) },
  }
  try {
    const { ShoppingListViewV2 } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListViewV2.tsx',
    )
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: storage },
    })

    const current = basket()
    const render = () => renderToStaticMarkup(createElement(ShoppingListViewV2, { basket: current }))
    const clean = render()
    assert.match(clean, /Boodschappenlijst/)
    assert.doesNotMatch(clean, /Opgeslagen lijst laden/)
    const first = current.lines.find((row) => row.status === 'matched')
    assert.ok(first)
    values.set(shoppingListProgressV2StorageKey, serializeShoppingProgressV2(current, [first.id]))
    const firstPaint = render()
    assert.match(firstPaint, /0 van \d+ afgevinkt/,
      'saved progress can be restored by the mounted effect, not during SSR')
    assert.doesNotMatch(firstPaint, /Opgeslagen lijst laden/)
    assert.deepEqual(writes, [], 'SSR opening existing progress never writes or reloads')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete globalThis.window
    await vite.close()
  }
})
