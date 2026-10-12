import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'

function basket() {
  return buildOneStoreBasket({
    store: { ...m2Store }, plan: m2InitialPlan, recipes: m2Recipes,
    products: m2Products, activeDays: ['Di'],
  })
}

function matched(subject) {
  const line = subject.lines.find((entry) => entry.status === 'matched')
  assert.ok(line)
  return line
}

test('product composed v2: actual React view fails closed for blank display names but renders valid Dutch piece rows', async () => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    const { ShoppingListViewV2 } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListViewV2.tsx',
    )
    const render = (subject) => renderToStaticMarkup(
      createElement(ShoppingListViewV2, { basket: subject }),
    )
    delete globalThis.window

    const invalidCases = [
      ['store', (subject) => { subject.store.name = '\u2800' }],
      ['ingredient', (subject) => { matched(subject).ingredientLabel = '\u3164' }],
      ['matched product', (subject) => { matched(subject).productName = '\u200b\u0301' }],
      ['physical product', (subject) => { matched(subject).productId = '\u1160' }],
    ]
    for (const [name, mutate] of invalidCases) {
      const subject = basket()
      mutate(subject)
      const original = structuredClone(subject)
      const markup = render(subject)
      assert.match(markup, /Boodschappenlijst/, name)
      assert.doesNotMatch(markup, /class="shopping-row/, name)
      assert.doesNotMatch(markup, /aria-pressed="true"/, name)
      assert.doesNotMatch(markup, / × 1 stuk/, name)
      assert.deepEqual(subject, original, name)
    }

    const valid = basket()
    const row = matched(valid)
    valid.store.name = 'Winkel 🌍'
    row.ingredientLabel = 'رز'
    row.productName = 'Product met leesbaar etiket'
    row.pack = { ...row.pack, amount: 1, unit: 'piece', count: 1 }
    const original = structuredClone(valid)
    const server = render(valid)
    assert.match(server, /class="shopping-row/)
    assert.match(server, / × 1 stuk/)
    assert.match(server, /Product met leesbaar etiket/)
    assert.doesNotMatch(server, / × 1 piece/)
    assert.doesNotMatch(server, /€[0-9]/)
    assert.deepEqual(valid, original)

    // A future record must not change the first rendered paint or be rewritten.
    const writes = []
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: {
        getItem(key) {
          return key === shoppingListProgressV2StorageKey
            ? '{"schemaVersion":3,"opaque":true}' : null
        },
        setItem(key, value) { writes.push([key, value]) },
      } },
    })
    assert.equal(render(valid), server, 'SSR and browser-like initial paint must match')
    assert.deepEqual(writes, [], 'React render must never rewrite an unknown v2 schema')
    assert.deepEqual(valid, original)
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else delete globalThis.window
    await vite.close()
  }
})
