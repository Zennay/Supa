import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'

function weeklyBasket(activeDays = ['Di']) {
  return buildOneStoreBasket({
    store: { ...m2Store },
    plan: m2InitialPlan,
    recipes: m2Recipes,
    products: m2Products,
    activeDays,
  })
}

async function withShoppingView(run) {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    const { ShoppingListViewV2 } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListViewV2.tsx',
    )
    delete globalThis.window
    const render = (basket) => renderToStaticMarkup(
      createElement(ShoppingListViewV2, { basket }),
    )
    await run(render)
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
    await vite.close()
  }
}

function assertUnavailable(html, name) {
  assert.match(html, /role="status"/, name)
  assert.match(html, /Boodschappenlijst niet beschikbaar/, name)
  assert.match(html, /Controleer je planning/, name)
  assert.doesNotMatch(html, /Geen boodschappen voor deze planning/, name)
  assert.doesNotMatch(html, /class="shopping-row/, name)
  assert.doesNotMatch(html, /\d+ van \d+ afgevinkt/, name)
  assert.doesNotMatch(html, /€/, name)
}

test('QA: an invalid empty physical basket cannot be announced as a legitimately empty plan', async () => {
  await withShoppingView((render) => {
    const trulyEmpty = weeklyBasket([])
    assert.equal(trulyEmpty.lines.length, 0)
    assert.equal(typeof shoppingListDemandIdentity(trulyEmpty), 'string')
    assert.match(render(trulyEmpty), /Geen boodschappen voor deze planning/)

    for (const [name, mutate] of [
      ['unreadable store name', (basket) => { basket.store.name = '\u2800' }],
      ['invisible store id', (basket) => { basket.store.id = '\u200d' }],
      ['lone surrogate store id', (basket) => { basket.store.id = '\ud800' }],
    ]) {
      const invalid = structuredClone(trulyEmpty)
      mutate(invalid)
      const original = structuredClone(invalid)
      assert.equal(shoppingListDemandIdentity(invalid), null, name)
      assertUnavailable(render(invalid), name)
      assert.deepEqual(invalid, original, name)
    }
  })
})

test('QA: invalid physical lines never become interactive checkboxes or misleading zero progress', async () => {
  await withShoppingView((render) => {
    const original = weeklyBasket()
    assert.ok(original.lines.length > 1)
    assert.ok(original.lines.some((line) => line.status === 'matched'))
    for (const [name, mutate] of [
      ['duplicate physical line key', (basket) => {
        basket.lines[1].id = basket.lines[0].id
      }],
      ['invisible ingredient label', (basket) => {
        basket.lines[0].ingredientLabel = '\u034f'
      }],
      ['unreadable product label', (basket) => {
        basket.lines.find((line) => line.status === 'matched').productName = '\u3164'
      }],
      ['invalid amount', (basket) => {
        basket.lines[0].requirement.amount = Infinity
      }],
    ]) {
      const invalid = structuredClone(original)
      mutate(invalid)
      const copy = structuredClone(invalid)
      assert.equal(shoppingListDemandIdentity(invalid), null, name)
      assertUnavailable(render(invalid), name)
      assert.deepEqual(invalid, copy, name)
    }
  })
})

test('QA: a price-only refresh never alters the visible physical shopping tasks', async () => {
  await withShoppingView((render) => {
    const original = weeklyBasket()
    const repriced = structuredClone(original)
    const initialSnapshot = structuredClone(original)
    const nextSnapshot = structuredClone(repriced)
    repriced.totalCents += 101

    assert.equal(shoppingListDemandIdentity(original), shoppingListDemandIdentity(repriced))
    const before = render(original)
    const after = render(repriced)
    assert.match(before, /class="shopping-row/)
    assert.equal(after, before)
    assert.deepEqual(original, initialSnapshot)
    assert.deepEqual(repriced, { ...nextSnapshot, totalCents: nextSnapshot.totalCents + 101 })
  })
})
