import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey as v2Key } from '../src/features/shopping-list/shoppingListProgressV2.ts'

const basket = buildOneStoreBasket({
  store: m2Store,
  products: m2Products,
  recipes: m2Recipes,
  plan: m2InitialPlan,
  activeDays: ['Di'],
})
const lineId = basket.lines.find((line) => line.status === 'matched')?.id
assert.ok(lineId)

test('unavailable or read-denied storage keeps ticks in memory but never promises persistence', () => {
  for (const storage of [
    null,
    { getItem() { throw Error('private storage') }, setItem() { throw Error('unexpected write') } },
  ]) {
    const controller = openShoppingProgressStorageV2(basket, storage)
    assert.equal(controller.storageFormatStatus(), 'unavailable')
    assert.deepEqual(controller.snapshot().completedLineIds, [])
    assert.ok(controller.toggle(lineId).completedLineIds.includes(lineId))
    assert.equal(controller.persist(), false)
    assert.equal(controller.storageFormatStatus(), 'unavailable')
    assert.ok(controller.snapshot().completedLineIds.includes(lineId))
    assert.equal(controller.reloadSaved(), null)
    assert.ok(controller.snapshot().completedLineIds.includes(lineId))
  }
})

test('valid empty v2 storage stays ready and saves real user toggles', () => {
  const writes = []
  const data = new Map()
  const storage = {
    getItem(key) { return data.get(key) ?? null },
    setItem(key, value) { writes.push([key, value]); data.set(key, value) },
  }
  const controller = openShoppingProgressStorageV2(basket, storage)
  assert.equal(controller.storageFormatStatus(), 'ready')
  controller.toggle(lineId)
  assert.equal(controller.persist(), true)
  assert.equal(controller.storageFormatStatus(), 'ready')
  assert.equal(writes.length, 1)
  assert.equal(writes[0][0], v2Key)
})

test('unavailable-storage notice is mount-only and separate from unknown-schema protection', async () => {
  const viewSource = await readFile(new URL('../src/features/shopping-list/ShoppingListViewV2.tsx', import.meta.url), 'utf8')
  // Lightweight wiring guard: the mount effect must take the controller's
  // actual diagnostic, not infer storage availability from checkbox state.
  assert.match(viewSource, /setUnavailableStorage\(controller\.storageFormatStatus\(\) === 'unavailable'\)/)
  assert.match(viewSource, /unavailableStorage &&/)
  assert.match(viewSource, /unknownStoredRecord &&/)
  assert.match(viewSource, /Opgeslagen voortgang niet beschikbaar/)
  assert.match(viewSource, /Opgeslagen boodschappenlijst beschermd/)

  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    const { ShoppingListViewV2 } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListViewV2.tsx',
    )
    // SSR must be neutral whether storage is missing or getter access throws;
    // the client effect is responsible for the actual warning after mount.
    for (const value of [
      undefined,
      Object.defineProperty({}, 'localStorage', { get() { throw Error('disabled') } }),
    ]) {
      if (value === undefined) delete globalThis.window
      else Object.defineProperty(globalThis, 'window', { configurable: true, value })
      const html = renderToStaticMarkup(createElement(ShoppingListViewV2, { basket }))
      assert.match(html, /Boodschappenlijst/)
      assert.doesNotMatch(html, /Opgeslagen voortgang niet beschikbaar/)
      assert.doesNotMatch(html, /Opgeslagen boodschappenlijst beschermd/)
    }
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
    await vite.close()
  }
})
