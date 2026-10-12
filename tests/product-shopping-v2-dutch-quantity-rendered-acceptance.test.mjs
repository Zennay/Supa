import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'

function basket() {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: ['Di'], products: m2Products,
  })
}

test('product #1809: real shopping-v2 React SSR renders Dutch quantity units without storage writes', async () => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const existingWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    const { ShoppingListViewV2 } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListViewV2.tsx',
    )
    const render = (subject) => renderToStaticMarkup(
      createElement(ShoppingListViewV2, { basket: subject }),
    )

    const unknown = basket()
    const unknownLine = unknown.lines.find((line) => line.status === 'matched')
    assert.ok(unknownLine)
    unknownLine.status = 'unresolved'
    unknownLine.requirement = { amount: null, unit: 'unknown' }
    const unknownBefore = structuredClone(unknown)
    const unknownIdentity = shoppingListDemandIdentity(unknown)
    assert.equal(typeof unknownIdentity, 'string')

    delete globalThis.window
    const serverMarkup = render(unknown)
    assert.match(serverMarkup, /Boodschappenlijst/)
    assert.match(serverMarkup, /\? onbekend · handmatig kiezen/)
    assert.match(serverMarkup, /productkeuze vraagt controle/)
    assert.doesNotMatch(serverMarkup, /\? unknown · handmatig kiezen/)
    assert.doesNotMatch(serverMarkup, /aria-pressed="true"/)
    assert.deepEqual(unknown, unknownBefore)

    const data = new Map([[shoppingListProgressV2StorageKey, JSON.stringify({
      schemaVersion: 3, futureOnly: true,
    })]])
    const writes = []
    Object.defineProperty(globalThis, 'window', {
      configurable: true, value: { localStorage: {
        getItem(key) { return data.get(key) ?? null },
        setItem(key, value) { writes.push([key, value]); data.set(key, value) },
      } },
    })
    assert.equal(render(unknown), serverMarkup,
      'browser storage, including an unknown future record, cannot change hydration markup')
    assert.deepEqual(writes, [], 'render never persists or downgrades stored records')
    assert.equal(shoppingListDemandIdentity(unknown), unknownIdentity)
    assert.deepEqual(unknown, unknownBefore)

    const pieces = basket()
    const packLine = pieces.lines.find((line) => line.status === 'matched')
    assert.ok(packLine)
    packLine.pack = { ...packLine.pack, amount: 1, unit: 'piece', count: 1 }
    packLine.packs = 2
    const firstHtml = render(pieces)
    assert.match(firstHtml, /2 × 1 stuk/)
    assert.doesNotMatch(firstHtml, /2 × 1 piece/)
    assert.doesNotMatch(firstHtml, /€[0-9]/)

    packLine.pack.amount = 3
    packLine.pack.count = 2
    const pluralHtml = render(pieces)
    assert.match(pluralHtml, /2 × 2 × 3 stuks/)
    assert.doesNotMatch(pluralHtml, /3 piece/)

    packLine.pack.amount = 400
    packLine.pack.unit = 'g'
    const metricHtml = render(pieces)
    assert.match(metricHtml, /2 × 2 × 400 g/)
    assert.doesNotMatch(metricHtml, /\bonbekend\b/)
    assert.deepEqual(writes, [])
  } finally {
    if (existingWindow) Object.defineProperty(globalThis, 'window', existingWindow)
    else delete globalThis.window
    await vite.close()
  }
})
