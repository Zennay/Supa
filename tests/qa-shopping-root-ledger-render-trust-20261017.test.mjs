import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Recipes, m2Products, m2Store } from '../src/data/m2Fixture.ts'
import {
  shoppingListBasketKey,
  restoreShoppingListProgress,
  serializeShoppingListProgress,
} from '../src/features/shopping-list/shoppingListProgress.ts'

// One-store M2 fixture is completely controlled: these are not real retailer
// prices or a shopping/savings publication.
function validBasket() {
  return buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: ['Di'],
    products: m2Products,
  })
}

function corruptedBaskets() {
  const original = validBasket()
  assert.ok(original.lines.length > 0)
  assert.ok(original.selectedMealCount > 0)
  assert.equal(original.lines.length, original.matchedLineCount + original.unresolvedLineCount)
  assert.equal(original.totalCents,
    original.lines.filter(row => row.status === 'matched')
      .reduce((sum, row) => sum + row.lineTotalCents, 0))

  const cases = [
    ['whole total +1 cent', data => { data.totalCents += 1 }],
    ['whole total -1 cent', data => { data.totalCents -= 1 }],
    ['matched counter +1', data => { data.matchedLineCount += 1 }],
    ['matched counter -1', data => { data.matchedLineCount -= 1 }],
    ['unresolved counter +1', data => { data.unresolvedLineCount += 1 }],
    ['unresolved counter -1', data => { data.unresolvedLineCount -= 1 }],
    ['selected meals become zero', data => { data.selectedMealCount = 0 }],
    ['selected meals become negative', data => { data.selectedMealCount = -1 }],
    ['store ID becomes visually blank', data => { data.store.id = '\u2800' }],
    ['store name becomes visually blank', data => { data.store.name = '\u200B' }],
  ]
  return cases.map(([name, mutate]) => {
    const basket = structuredClone(original)
    mutate(basket)
    return [name, basket]
  })
}

test('positive: real valid populated week retains persisted checkmarks and printable rows', async () => {
  const basket = validBasket()
  const original = structuredClone(basket)
  const raw = serializeShoppingListProgress(basket, [basket.lines[0].id])
  assert.equal(typeof shoppingListBasketKey(basket), 'string')
  assert.deepEqual(restoreShoppingListProgress(basket, raw), [basket.lines[0].id])
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  try {
    const { ShoppingListView } = await vite.ssrLoadModule('/src/features/shopping-list/ShoppingListView.tsx')
    const markup = renderToStaticMarkup(createElement(ShoppingListView, { basket }))
    assert.match(markup, /Print boodschappenlijst/)
    assert.match(markup, /class="shopping-row/)
    assert.doesNotMatch(markup, /Boodschappenlijst niet beschikbaar/)
    assert.deepEqual(basket, original)
  } finally { await vite.close() }
})

test('QA P1: malformed populated basket root must never mint/restored checked identity', async t => {
  const safe = validBasket()
  const existing = serializeShoppingListProgress(safe, [safe.lines[0].id])
  for (const [label, basket] of corruptedBaskets()) {
    await t.test(label, () => {
      const original = structuredClone(basket)
      assert.throws(() => shoppingListBasketKey(basket),
        /Invalid shopping list basket runtime shape/, label)
      assert.throws(() => serializeShoppingListProgress(basket, [safe.lines[0].id]),
        /Invalid shopping list basket runtime shape/, label)
      assert.deepEqual(restoreShoppingListProgress(basket, existing), [], label)
      assert.deepEqual(basket, original, label)
    })
  }
})

test('QA P1: 10 tampered whole-basket aggregates cannot appear printable or read previously saved progress', async t => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let storageReads = 0
  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        get localStorage() {
          storageReads++
          throw Error('fictional-private-storage-value')
        },
      },
    })
    const { ShoppingListView } = await vite.ssrLoadModule('/src/features/shopping-list/ShoppingListView.tsx')
    for (const [label, basket] of corruptedBaskets()) {
      await t.test(label, () => {
        const original = structuredClone(basket)
        const markup = renderToStaticMarkup(createElement(ShoppingListView, { basket }))
        assert.match(markup, /Boodschappenlijst niet beschikbaar/, label)
        assert.match(markup, /Afdrukken is niet beschikbaar/, label)
        assert.doesNotMatch(markup, /Print boodschappenlijst|class="shopping-row|fictional-private-storage-value/, label)
        assert.deepEqual(basket, original, label)
      })
    }
    assert.equal(storageReads, 0)
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
    await vite.close()
  }
})
