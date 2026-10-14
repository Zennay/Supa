import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'

test('product v1: only a rowless, zero-cent week with a visible trusted store can say no groceries', async () => {
  // Real component SSR with synthetic M2 source. No browser hydration or field prices.
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { ShoppingListView } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListView.tsx',
    )
    const empty = buildOneStoreBasket({
      store: m2Store, products: m2Products, plan: m2InitialPlan,
      recipes: m2Recipes, activeDays: [],
    })
    assert.equal(empty.lines.length, 0)
    assert.equal(empty.totalCents, 0)
    const render = basket => renderToStaticMarkup(
      createElement(ShoppingListView, { basket }),
    )
    const genuine = render(empty)
    assert.match(genuine, /Geen boodschappen voor deze planning/)
    assert.doesNotMatch(genuine, /Boodschappenlijst niet beschikbaar/)

    for (const [description, brokenStore] of [
      ['missing store id', { id: '' }],
      ['whitespace store id', { id: ' \t ' }],
      ['control-only store id', { id: '\u0000\u0007' }],
      ['invisible store id', { id: '\u200B\u200D' }],
      ['mark-only store id', { id: '\u0301' }],
      ['missing visible store label', { name: '' }],
      ['whitespace store label', { name: ' \n ' }],
      ['invisible store label', { name: '\u200B\u200D' }],
      ['combining-mark store label', { name: '\u0301' }],
      ['braille-blank store label', { name: '\u2800' }],
      ['hangul-filler store label', { name: '\u3164' }],
      ['null runtime store label', { name: null }],
    ]) {
      const basket = { ...empty, store: { ...empty.store, ...brokenStore } }
      const original = structuredClone(basket)
      const html = render(basket)
      assert.match(html, /role="status"/, description)
      assert.match(html, /Boodschappenlijst niet beschikbaar/, description)
      assert.doesNotMatch(html, /Geen boodschappen voor deze planning/, description)
      assert.doesNotMatch(html, /class="shopping-row/, description)
      assert.deepEqual(basket, original, description + ': no mutation')
    }

    const nonEmpty = buildOneStoreBasket({
      store: m2Store, products: m2Products, plan: m2InitialPlan,
      recipes: m2Recipes, activeDays: ['Di'],
    })
    const normal = render(nonEmpty)
    assert.match(normal, /class="shopping-row/)
    assert.doesNotMatch(normal, /Boodschappenlijst niet beschikbaar/)
    assert.doesNotMatch(normal, /Geen boodschappen voor deze planning/)
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
    await vite.close()
  }
})
