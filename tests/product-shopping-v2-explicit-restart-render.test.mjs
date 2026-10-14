import assert from 'node:assert/strict'
import test from 'node:test'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
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
    const firstPaint = render(first)
    assert.doesNotMatch(firstPaint, /Vinkjes wissen/,
      'the first render cannot inspect saved progress without risking hydration drift')
    assert.match(firstPaint, /0 van \d+ afgevinkt/)
    assert.deepEqual(openShoppingProgressStorageV2(first, storage).snapshot().completedLineIds,
      [picked.id], 'saved progress remains recoverable by the mounted effect')
    const repriced = basket(m2Store, m2Products.map((product) => ({
      ...product, priceCents: product.priceCents + 4,
    })))
    assert.doesNotMatch(render(repriced), /Vinkjes wissen/)
    assert.deepEqual(openShoppingProgressStorageV2(repriced, storage).snapshot().completedLineIds,
      [picked.id], 'price-only changes retain saved physical progress after mount')

    const differentStore = basket({ ...m2Store, id: 'synthetic-new-store' })
    assert.doesNotMatch(render(differentStore), /Vinkjes wissen/)

    // The clear affordance itself must obey the exact physical-demand key,
    // not merely be present because a previously saved record lists an ID.
    const physicallyChanged = [
      (() => { const changed = structuredClone(first)
        changed.lines.find((line) => line.id === picked.id).productId = 'synthetic-different-product'
        return changed })(),
      (() => { const changed = structuredClone(first)
        changed.lines.find((line) => line.id === picked.id).pack.count += 1
        return changed })(),
      (() => { const changed = structuredClone(first)
        changed.lines.find((line) => line.id === picked.id).requirement.amount += 1
        return changed })(),
      (() => { const changed = structuredClone(first)
        changed.lines.find((line) => line.id === picked.id).status = 'unresolved'
        return changed })(),
    ]
    for (const changed of physicallyChanged) {
      assert.doesNotMatch(render(changed), /Vinkjes wissen/,
        'stale checked IDs cannot authorize a restart on changed physical demand')
    }

    const reordered = structuredClone(first)
    reordered.lines.reverse()
    assert.doesNotMatch(render(reordered), /Vinkjes wissen/)
    assert.deepEqual(openShoppingProgressStorageV2(reordered, storage).snapshot().completedLineIds,
      [picked.id], 'row order must not change saved physical task')
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
