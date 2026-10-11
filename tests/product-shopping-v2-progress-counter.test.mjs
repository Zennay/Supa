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

function basket(store = m2Store, products = m2Products) {
  return buildOneStoreBasket({
    store,
    products,
    activeDays: ['Di'],
    plan: m2InitialPlan,
    recipes: m2Recipes,
  })
}

const pressed = (html) => [...html.matchAll(/aria-pressed="true"/g)].length
const count = (html) => [...html.matchAll(/aria-pressed="(?:true|false)"/g)].length

test('real v2 shopping screen counts only physically valid checked tasks', async () => {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const values = new Map()
  const writes = []
  const storage = {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { writes.push(key); values.set(key, value) },
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
    const initial = basket()
    const clean = render(initial)
    assert.ok(count(clean) > 0)
    assert.equal(pressed(clean), 0)
    assert.match(clean, new RegExp(`0 van ${count(clean)} afgevinkt`))
    assert.match(clean, /role="status"[^>]*aria-live="polite"/)

    const picked = initial.lines.find((row) => row.status === 'matched')
    assert.ok(picked)
    values.set(
      shoppingListProgressV2StorageKey,
      serializeShoppingProgressV2(initial, [picked.id]),
    )
    const restored = render(initial)
    assert.equal(pressed(restored), 1)
    assert.match(restored, new RegExp(`1 van ${count(restored)} afgevinkt`))

    const repricedBasket = basket(m2Store, m2Products.map((product) => ({
      ...product,
      priceCents: product.priceCents + 7,
    })))
    assert.notEqual(repricedBasket.totalCents, initial.totalCents)
    const repriced = render(repricedBasket)
    assert.equal(pressed(repriced), 1, 'price-only changes retain checked physical tasks')
    assert.match(repriced, new RegExp(`1 van ${count(repriced)} afgevinkt`))

    const storedWithPhantom = JSON.parse(
      serializeShoppingProgressV2(initial, [picked.id]),
    )
    storedWithPhantom.doneLineIds = [picked.id, picked.id, 'synthetic-phantom-id']
    values.set(shoppingListProgressV2StorageKey, JSON.stringify(storedWithPhantom))
    const deduplicated = render(initial)
    assert.equal(pressed(deduplicated), 1, 'phantom/duplicate IDs must not inflate totals')
    assert.match(deduplicated, new RegExp(`1 van ${count(deduplicated)} afgevinkt`))

    const unresolved = render(basket(m2Store, []))
    assert.match(unresolved, /handmatig kiezen/)
    assert.equal(pressed(unresolved), 0)
    assert.match(unresolved, new RegExp(`0 van ${count(unresolved)} afgevinkt`))

    const newStore = render(basket({ ...m2Store, id: 'synthetic-second-store' }))
    assert.equal(pressed(newStore), 0)
    assert.match(newStore, new RegExp(`0 van ${count(newStore)} afgevinkt`))

    const rejected = render({ ...initial, lines: [null] })
    assert.equal(count(rejected), 0)
    assert.doesNotMatch(rejected, / van \d+ afgevinkt/)

    const empty = render({ ...initial, lines: [] })
    assert.equal(count(empty), 0)
    assert.doesNotMatch(empty, / van \d+ afgevinkt/)
    assert.deepEqual(writes, [], 'render must never persist a progress update')
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
    await vite.close()
  }
})
