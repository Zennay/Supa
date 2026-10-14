import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { serializeShoppingProgressV2, shoppingListProgressV2StorageKey as key } from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { shoppingListRowsV2 } from '../src/features/shopping-list/shoppingListRowsV2.ts'

function fixture() {
  return buildOneStoreBasket({
    store: m2Store, products: m2Products, recipes: m2Recipes,
    plan: m2InitialPlan, activeDays: ['Di'],
  })
}

function disk(saved = null) {
  const records = new Map()
  if (saved !== null) records.set(key, saved)
  const writes = []
  return {
    records, writes,
    getItem(name) { assert.equal(name, key); return records.get(name) ?? null },
    setItem(name, value) { assert.equal(name, key); writes.push(value); records.set(name, value) },
  }
}

function badLabel(target, value) {
  const result = structuredClone(fixture())
  const matched = result.lines.find((line) => line.status === 'matched')
  assert.ok(matched)
  if (target === 'store') result.store.name = value
  if (target === 'ingredient') matched.ingredientLabel = value
  if (target === 'product') matched.productName = value
  if (target === 'unresolved') {
    matched.status = 'unresolved'
    matched.ingredientLabel = value
  }
  return result
}

// Separate postrepair test-only acceptance, independent of expected-RED #1814.
// Whitespace-only was covered by RED; these previously *untested* invisible
// codepoints render as missing labels despite being JS nonempty strings.
for (const [name, label] of [
  ['zero-width space', '\u200b'],
  ['format joiner', '\u200d'],
  ['combining acute', '\u0301'],
  ['C1 control', '\u0085'],
  ['mixed invisible', '\u200b\u0301\u0085'],
]) {
  for (const target of ['store', 'ingredient', 'product', 'unresolved']) {
    test(`product #1101 independent: ${name} cannot stand in for ${target} copy`, () => {
      const basket = badLabel(target, label)
      const before = structuredClone(basket)
      const storage = disk()
      const tab = openShoppingProgressStorageV2(basket, storage)
      assert.equal(shoppingListDemandIdentity(basket), null)
      assert.equal(serializeShoppingProgressV2(basket, basket.lines.map(line => line.id)), null)
      assert.equal(tab.persist(), false)
      assert.deepEqual(shoppingListRowsV2(basket, tab.snapshot()), [])
      assert.deepEqual(storage.writes, [])
      assert.deepEqual(basket, before)
    })
  }
}

test('product #1101 independent: Unicode names and label-only repricing retain checked physical progress', () => {
  const original = fixture()
  const changed = structuredClone(original)
  changed.store.name = 'Winkel 🛒 متجر'
  for (const line of changed.lines) {
    line.ingredientLabel = '🥦 ' + line.ingredientLabel + ' cafe\u0301'
    if (line.status === 'matched') {
      line.productName = '✅ منتج ' + line.productName
      line.pricePerPackCents += 3
      line.lineTotalCents += 3 * line.packs
    }
  }
  const picked = original.lines.find(line => line.status === 'matched')
  assert.ok(picked)
  const storage = disk(serializeShoppingProgressV2(original, [picked.id]))
  const tab = openShoppingProgressStorageV2(original, storage)
  assert.equal(shoppingListDemandIdentity(changed), shoppingListDemandIdentity(original))
  assert.deepEqual(tab.rebase(changed).completedLineIds, [picked.id])
  assert.equal(tab.persist(), true)
  assert.equal(shoppingListRowsV2(changed, tab.snapshot()).find(row => row.id === picked.id).checked, true)
  assert.deepEqual(changed.store.name, 'Winkel 🛒 متجر')
  assert.equal(storage.writes.length, 1)
})

test('product #1101 independent: a supported foreign saved task remains replaceable on explicit new-task action', () => {
  const basket = fixture()
  const foreign = structuredClone(basket)
  foreign.store.id = 'another-physical-shop'
  foreign.store.name = 'Andere winkel'
  const id = foreign.lines.find(line => line.status === 'matched')?.id
  assert.ok(id)
  const saved = serializeShoppingProgressV2(foreign, [id])
  assert.equal(typeof saved, 'string')
  const storage = disk(saved)
  const tab = openShoppingProgressStorageV2(basket, storage)
  assert.equal(tab.storageFormatStatus(), 'ready',
    'canonical foreign identity lacks display labels; reconstruction must remain valid')
  assert.deepEqual(tab.snapshot().completedLineIds, [])
  tab.toggle(id)
  assert.equal(tab.persist(), true)
  assert.notEqual(storage.records.get(key), saved)
  assert.deepEqual(JSON.parse(storage.records.get(key)).doneLineIds, [id])
})

test('product #1101 independent: malformed live names cannot overwrite a valid saved checklist', () => {
  const original = fixture()
  const id = original.lines.find(line => line.status === 'matched')?.id
  assert.ok(id)
  const saved = serializeShoppingProgressV2(original, [id])
  const storage = disk(saved)
  const tab = openShoppingProgressStorageV2(original, storage)
  const malformed = structuredClone(original)
  const selected = malformed.lines.find(line => line.id === id)
  selected.productName = { value: 'not renderable' }
  assert.equal(tab.rebase(malformed).serialized, null)
  assert.equal(tab.persist(), false)
  assert.equal(storage.records.get(key), saved)
  assert.deepEqual(storage.writes, [])
})

test('product #1101 independent: actual React shopping-v2 SSR never renders an invalid object product label', async () => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const existingWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { ShoppingListViewV2 } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListViewV2.tsx',
    )
    const malformed = badLabel('product', { hidden: 'not-a-renderable-name' })
    const before = structuredClone(malformed)
    const html = renderToStaticMarkup(createElement(ShoppingListViewV2, { basket: malformed }))
    assert.match(html, /Boodschappenlijst/)
    assert.doesNotMatch(html, /not-a-renderable-name/)
    assert.doesNotMatch(html, /aria-pressed="true"/)
    assert.doesNotMatch(html, /€[0-9]/)
    assert.deepEqual(malformed, before)
  } finally {
    if (existingWindow) Object.defineProperty(globalThis, 'window', existingWindow)
    else delete globalThis.window
    await vite.close()
  }
})
