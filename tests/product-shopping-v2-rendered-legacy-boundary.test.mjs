import assert from 'node:assert/strict'
import test from 'node:test'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import {
  serializeShoppingListProgress,
  shoppingListProgressStorageKey,
} from '../src/features/shopping-list/shoppingListProgress.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

function basket(products = m2Products) {
  return buildOneStoreBasket({
    store: m2Store,
    products,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: ['Di'],
  })
}

function checkedCount(markup) {
  return [...markup.matchAll(/aria-pressed="true"/g)].length
}

test('real shopping-list TSX never silently upgrades legacy progress while rendering', async () => {
  // SSR executes the production React TSX, not a copied model/JSX substitute.
  // Effects/clicks require separate permanent browser acceptance.
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const oldWindow = globalThis.window
  const data = new Map()
  const reads = []
  const writes = []
  const disk = {
    getItem(key) {
      reads.push(key)
      return data.get(key) ?? null
    },
    setItem(key, value) {
      writes.push([key, value])
      data.set(key, value)
    },
  }

  try {
    const { ShoppingListViewV2 } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListViewV2.tsx',
    )
    globalThis.window = { localStorage: disk }
    const render = (value, options = {}) => renderToStaticMarkup(
      createElement(ShoppingListViewV2, { basket: value, ...options }),
    )

    const initial = basket()
    const matched = initial.lines.filter((line) => line.status === 'matched')
    assert.ok(matched.length >= 2, 'the canonical M2 sample needs independent checkmarks')
    const rawV1 = serializeShoppingListProgress(initial, [matched[0].id])
    data.set(shoppingListProgressStorageKey, rawV1)

    // The product has no permission to reinterpret old v1 storage by default.
    reads.length = 0
    assert.equal(checkedCount(render(initial)), 0)
    assert.deepEqual(reads, [shoppingListProgressV2StorageKey])

    // An explicit owner opt-in may *read* an exact, unchanged v1 task,
    // but an initial render still cannot write any migrated v2 record.
    reads.length = 0
    assert.equal(checkedCount(render(initial, { allowLegacyUpgrade: true })), 1)
    assert.deepEqual(reads, [
      shoppingListProgressV2StorageKey,
      shoppingListProgressStorageKey,
    ])
    assert.equal(data.has(shoppingListProgressV2StorageKey), false)
    assert.deepEqual(writes, [])

    // v1's financial basket key is deliberately price-sensitive. A one-cent
    // change prevents opt-in upgrade rather than guessing equivalence.
    const repriced = basket(m2Products.map((product) =>
      product.id === matched[0].productId
        ? { ...product, priceCents: product.priceCents + 1 }
        : product,
    ))
    assert.notEqual(initial.totalCents, repriced.totalCents)
    assert.equal(checkedCount(render(repriced, { allowLegacyUpgrade: true })), 0)

    // A present but corrupt v2 record must prevent hidden fallback to the
    // valid legacy v1 record, even when a caller opts into legacy upgrade.
    data.set(shoppingListProgressV2StorageKey, '{invalid-v2-json')
    reads.length = 0
    assert.equal(checkedCount(render(initial, { allowLegacyUpgrade: true })), 0)
    assert.deepEqual(reads, [shoppingListProgressV2StorageKey])

    // A valid v2 record is authoritative even if v1 has a different tick.
    data.set(
      shoppingListProgressV2StorageKey,
      serializeShoppingProgressV2(initial, [matched[1].id]),
    )
    reads.length = 0
    assert.equal(checkedCount(render(repriced, { allowLegacyUpgrade: true })), 1)
    assert.deepEqual(reads, [shoppingListProgressV2StorageKey])

    // v2 task identity includes the physical shop, unlike the price. No
    // checked product can survive a store switch, including on SSR reload.
    const changedShop = structuredClone(repriced)
    changedShop.store.id = 'synthetic-other-store'
    assert.equal(checkedCount(render(changedShop)), 0)
    assert.deepEqual(writes, [], 'all storage writes are prohibited during rendering')
  } finally {
    if (oldWindow === undefined) delete globalThis.window
    else globalThis.window = oldWindow
    await vite.close()
  }
})
