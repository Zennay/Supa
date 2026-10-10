import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'
import {
  restoreShoppingListProgress,
  serializeShoppingListProgress,
  shoppingListBasketKey,
} from '../src/features/shopping-list/shoppingListProgress.ts'

// Issue #248: synthetic M2 basket-only regressions. No retailer capture,
// real products, permissions or genuine M3 field data.
function basket(store = m2Store, products = m2Products) {
  return buildOneStoreBasket({
    store,
    products,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
  })
}

function riceLine(result) {
  const line = result.lines.find((item) => item.id === 'basmati-rice')
  assert.ok(line, 'fixture must still contain canonical rice demand')
  return line
}

test('QA #248: matched checklist progress cannot follow the same ingredient to another store', () => {
  const current = basket()
  const original = structuredClone(current)
  const marked = riceLine(current)
  assert.equal(marked.status, 'matched')
  const persisted = serializeShoppingListProgress(current, [marked.id])
  assert.deepEqual(restoreShoppingListProgress(current, persisted), [marked.id])

  const otherStore = { id: 'qa-other-store', name: m2Store.name }
  const otherProducts = m2Products.map((product) => ({
    ...product, storeId: otherStore.id,
  }))
  const switched = basket(otherStore, otherProducts)
  assert.equal(riceLine(switched).status, 'matched')
  assert.equal(riceLine(switched).productId, marked.productId)
  assert.notEqual(shoppingListBasketKey(switched), shoppingListBasketKey(current))
  assert.deepEqual(restoreShoppingListProgress(switched, persisted), [])
  assert.deepEqual(current, original)
})

test('QA #248: prior unresolved ingredient progress cannot automatically become completed after matching', () => {
  const missingRice = m2Products.filter((product) => product.id !== 'basmati-1kg')
  const unresolved = basket(m2Store, missingRice)
  assert.equal(riceLine(unresolved).status, 'unresolved')

  // Even if an older runtime state marked an unresolved ingredient as done,
  // the product/pack purchase becoming known requires renewed confirmation.
  const persisted = serializeShoppingListProgress(unresolved, ['basmati-rice'])
  assert.deepEqual(restoreShoppingListProgress(unresolved, persisted), ['basmati-rice'])

  const resolved = basket()
  assert.equal(riceLine(resolved).status, 'matched')
  assert.notEqual(shoppingListBasketKey(resolved), shoppingListBasketKey(unresolved))
  assert.deepEqual(restoreShoppingListProgress(resolved, persisted), [])
})

test('QA #248: matched progress cannot carry backward into unresolved ingredient state', () => {
  const matched = basket()
  const persisted = serializeShoppingListProgress(matched, ['basmati-rice'])
  const missingRice = m2Products.filter((product) => product.id !== 'basmati-1kg')
  const unresolved = basket(m2Store, missingRice)
  assert.equal(riceLine(unresolved).status, 'unresolved')
  assert.deepEqual(restoreShoppingListProgress(unresolved, persisted), [])
})

test('QA #248: harmless display-name-only store rename does not discard valid same-store progress', () => {
  const original = basket()
  const renamed = basket({ ...m2Store, name: 'Same fixture store — renamed' })
  const persisted = serializeShoppingListProgress(original, ['basmati-rice'])
  assert.equal(shoppingListBasketKey(original), shoppingListBasketKey(renamed))
  assert.deepEqual(restoreShoppingListProgress(renamed, persisted), ['basmati-rice'])
})
