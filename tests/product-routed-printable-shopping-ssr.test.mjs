import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'

test('live shopping tab includes user-triggered privacy-safe paper checklist and protects invalid baskets', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const view = await readFile(new URL('../src/features/shopping-list/ShoppingListView.tsx', import.meta.url), 'utf8')
  const css = await readFile(new URL('../src/features/shopping-list/PrintableShoppingChecklist.css', import.meta.url), 'utf8')
  assert.match(app, /ShoppingListView basket=\{basket\}/)
  assert.match(view, /<PrintableShoppingChecklist basket=\{basket\} \/>/)
  assert.match(css, /@media print/)
  assert.match(css, /body:has\(\.supa-printable-shopping\)/)
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { ShoppingListView } = await vite.ssrLoadModule('/src/features/shopping-list/ShoppingListView.tsx')
    const basket = buildOneStoreBasket({
      store: m2Store, plan: m2InitialPlan, products: m2Products,
      recipes: m2Recipes, activeDays: ['Di'],
    })
    const before = structuredClone(basket)
    const html = renderToStaticMarkup(createElement(ShoppingListView, { basket }))
    assert.match(html, /Print boodschappenlijst/)
    assert.match(html, /aria-label="Papieren boodschappenlijst"/)
    assert.match(html, /supa-printable-shopping__paper/)
    assert.match(html, /Geen liveprijzen of besparingsbewijs/)
    assert.match(html, /Toon kopieerbare lijst/)
    assert.match(html, /class="shopping-row/)
    assert.doesNotMatch(html, /<script\b|<iframe\b|priceCents|savingsCents|participantKey|€/)
    assert.deepEqual(basket, before)

    const invalid = structuredClone(basket)
    invalid.lines = Array(1) // sparse arrays are never trustworthy print data
    const fallback = renderToStaticMarkup(createElement(ShoppingListView, { basket: invalid }))
    assert.match(fallback, /Afdrukken is niet beschikbaar/)
    assert.doesNotMatch(fallback, /Print boodschappenlijst/)
    assert.doesNotMatch(fallback, /supa-printable-shopping__paper/)
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else delete globalThis.window
    await vite.close()
  }
})
