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

const fixtureBasket = (products = m2Products) => buildOneStoreBasket({
  store: m2Store,
  products,
  plan: m2InitialPlan,
  recipes: m2Recipes,
  activeDays: ['Di'],
})

const pressedCount = (html) => [...html.matchAll(/aria-pressed="true"/g)].length
const rowCount = (html) => [...html.matchAll(/aria-pressed="(?:true|false)"/g)].length

test('real shopping v2 SSR fails closed for unresolved tasks, forged progress and invalid baskets', async () => {
  // Independent additive QA: actual TSX via Vite + React SSR, not a copied UI.
  // SSR deliberately makes NO claims about click/effect/browser behavior.
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const oldWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const storage = new Map()
  const reads = []
  const writes = []
  const port = {
    getItem(key) { reads.push(key); return storage.get(key) ?? null },
    setItem(key, value) { writes.push([key, value]); storage.set(key, value) },
  }

  try {
    const { ShoppingListViewV2 } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListViewV2.tsx',
    )
    const render = (basket, options = {}) => renderToStaticMarkup(
      createElement(ShoppingListViewV2, { basket, ...options }),
    )
    const setWindow = (value) => Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value,
    })
    setWindow({ localStorage: port })

    // Without product matches, every ingredient stays explicitly manual.
    // Zero priced matches is NOT an automatically completed shopping basket.
    const unresolved = fixtureBasket([])
    assert.ok(unresolved.lines.length > 0)
    assert.equal(unresolved.matchedLineCount, 0)
    assert.equal(unresolved.unresolvedLineCount, unresolved.lines.length)
    const manualHtml = render(unresolved)
    assert.match(manualHtml, /productkeuze vraagt controle/)
    assert.match(manualHtml, /handmatig kiezen/)
    assert.equal(rowCount(manualHtml), unresolved.lines.length)
    assert.equal(pressedCount(manualHtml), 0)

    // A syntactically valid v2 record may contain repeated/unknown task IDs.
    // Only one real task may render checked; a phantom cannot create a row.
    const complete = fixtureBasket()
    const matched = complete.lines.find((line) => line.status === 'matched')
    assert.ok(matched)
    const canonical = JSON.parse(serializeShoppingProgressV2(complete, [matched.id]))
    canonical.doneLineIds = [matched.id, matched.id, 'synthetic-phantom-task']
    storage.set(shoppingListProgressV2StorageKey, JSON.stringify(canonical))
    const restoredHtml = render(complete)
    assert.equal(rowCount(restoredHtml), complete.lines.length)
    assert.equal(pressedCount(restoredHtml), 1)

    // A malformed basket with duplicate physical task IDs is untrusted, even
    // when storage contains an otherwise valid snapshot for the old basket.
    const duplicated = structuredClone(complete)
    duplicated.lines.push(structuredClone(duplicated.lines[0]))
    const rejectedHtml = render(duplicated)
    assert.match(rejectedHtml, /Geen boodschappen voor deze planning/)
    assert.equal(rowCount(rejectedHtml), 0)
    assert.equal(pressedCount(rejectedHtml), 0)

    // Even when migration is opted in, a failing getItem must not guess that
    // old v1 data are valid; the rendered list remains unchecked.
    setWindow({ localStorage: {
      getItem() { throw new Error('synthetic storage read denial') },
      setItem() { throw new Error('unexpected render-time write') },
    } })
    assert.equal(pressedCount(render(complete, { allowLegacyUpgrade: true })), 0)

    // React must escape untrusted display names rather than injecting HTML.
    setWindow({ localStorage: port })
    const injected = structuredClone(complete)
    injected.lines.find((line) => line.status === 'matched').productName =
      '<img src=x onerror=alert(1)>'
    const escapedHtml = render(injected)
    assert.doesNotMatch(escapedHtml, /<img\s/i)
    assert.match(escapedHtml, /&lt;img/)
    assert.equal(pressedCount(escapedHtml), 1, 'display-only rename must preserve the physical check')

    assert.deepEqual(writes, [], 'no SSR/render path may persist storage')
    assert.ok(reads.every((key) => key === shoppingListProgressV2StorageKey))
  } finally {
    if (oldWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', oldWindowDescriptor)
    } else {
      delete globalThis.window
    }
    await vite.close()
  }
})
