import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { shoppingVisibleLines } from '../src/features/shopping-list/shoppingVisibleLines.ts'
import { shoppingListCompletion } from '../src/features/shopping-list/shoppingListCompletion.ts'
import {
  serializeShoppingListProgress, restoreShoppingListProgress, shoppingListBasketKey,
} from '../src/features/shopping-list/shoppingListProgress.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'

function basket() {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products: m2Products,
  })
}

test('open-only projection keeps original order, references, and persisted checks unchanged', () => {
  const value = basket()
  const ids = value.lines.map((line) => line.id)
  assert.ok(ids.length >= 2, 'controlled basket needs multiple shopping rows')
  const checked = [ids[0], ids[ids.length - 1]]
  const before = structuredClone(value)
  const key = shoppingListBasketKey(value)
  const raw = serializeShoppingListProgress(value, checked)
  const copy = buildShoppingListCopyText(value, checked)
  const visible = shoppingVisibleLines(value.lines, checked, true)
  assert.deepEqual(visible.map((line) => line.id), ids.filter((id) => !checked.includes(id)))
  assert.ok(visible.every((line) => value.lines.includes(line)))
  assert.notStrictEqual(visible, value.lines)
  assert.deepEqual(shoppingVisibleLines(value.lines, checked, false), value.lines)
  assert.equal(shoppingListBasketKey(value), key)
  assert.equal(serializeShoppingListProgress(value, checked), raw)
  assert.deepEqual(restoreShoppingListProgress(value, raw), checked)
  assert.equal(buildShoppingListCopyText(value, checked), copy)
  assert.deepEqual(value, before)
})

test('a hidden checked unresolved decision cannot become evidence of a completed product match', () => {
  const value = basket()
  const unresolved = {
    id: 'synthetic-manual-choice', ingredientLabel: 'Nog zelf uitzoeken',
    requirement: { amount: null, unit: 'unknown' }, status: 'unresolved',
    reasons: ['synthetic fixture'], matchScore: null,
  }
  const withUnknown = {
    ...value,
    lines: [...value.lines, unresolved],
    unresolvedLineCount: value.unresolvedLineCount + 1,
  }
  const checked = [unresolved.id]
  const before = structuredClone(withUnknown)
  const remaining = shoppingVisibleLines(withUnknown.lines, checked, true)
  assert.ok(!remaining.some((line) => line.id === unresolved.id))
  assert.ok(shoppingVisibleLines(withUnknown.lines, checked, false).some((line) => line.id === unresolved.id))
  const completion = shoppingListCompletion(withUnknown, checked)
  assert.notEqual(completion.state, 'complete')
  assert.notEqual(completion.state, 'invalid')
  assert.deepEqual(withUnknown, before)
})

test('a fully checked basket has zero open rows, but the original basket and print text remain intact', () => {
  const value = basket()
  const allIds = value.lines.map((line) => line.id)
  const before = structuredClone(value)
  assert.deepEqual(shoppingVisibleLines(value.lines, allIds, true), [])
  assert.equal(shoppingVisibleLines(value.lines, allIds, false).length, value.lines.length)
  const originalCopy = buildShoppingListCopyText(value, allIds)
  assert.equal(typeof originalCopy, 'string')
  assert.match(originalCopy, /\[x\]/u)
  assert.deepEqual(restoreShoppingListProgress(
    value, serializeShoppingListProgress(value, allIds),
  ), allIds)
  assert.deepEqual(value, before)
})

test('the actual routed v1 ShoppingListView exposes a non-destructive open-only toggle', async () => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { ShoppingListView } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListView.tsx',
    )
    const value = basket()
    const original = structuredClone(value)
    const html = renderToStaticMarkup(createElement(ShoppingListView, { basket: value }))
    assert.match(html, /data-shopping-filter="all"/u)
    assert.match(html, /aria-pressed="false"/u)
    assert.match(html, /Alleen open/u)
    assert.match(html, /\d+ van \d+ open/u)
    assert.match(html, /Boodschappenlijst/u)
    assert.match(html, /Afdrukken/u)
    assert.deepEqual(value, original)
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
    await vite.close()
  }
})
