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

// EXPECTED RED on main for #1056. This uses the existing controlled M2 products,
// not observed supermarket prices. Do not update the v1 persistence format here.
function basket({ products = m2Products, store = m2Store } = {}) {
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })
}

function markedRice(original) {
  const rice = original.lines.find((line) => line.id === 'basmati-rice')
  assert.ok(rice)
  assert.equal(rice.status, 'matched')
  return rice.id
}

test('control: identical physical basket reload keeps a checked product', () => {
  const original = basket()
  const checkedId = markedRice(original)
  const persisted = serializeShoppingListProgress(original, [checkedId])
  assert.deepEqual(restoreShoppingListProgress(basket(), persisted), [checkedId])
})

test('expected RED: same product and demand, new price only, retain its checkmark', () => {
  const original = basket()
  const checkedId = markedRice(original)
  const persisted = serializeShoppingListProgress(original, [checkedId])
  const repriced = basket({
    products: m2Products.map((p) =>
      p.id === 'basmati-1kg' ? { ...p, priceCents: p.priceCents + 1 } : p),
  })
  const before = original.lines.find((line) => line.id === checkedId)
  const after = repriced.lines.find((line) => line.id === checkedId)
  assert.ok(before && after && before.status === 'matched' && after.status === 'matched')
  assert.equal(after.productId, before.productId)
  assert.equal(after.packs, before.packs)
  assert.deepEqual(after.requirement, before.requirement)
  assert.notEqual(after.pricePerPackCents, before.pricePerPackCents)
  assert.deepEqual(
    restoreShoppingListProgress(repriced, persisted),
    [checkedId],
    'a price-only refresh must not erase physical shopping progress',
  )
})

test('expected RED: an unrelated product price refresh retains rice progress', () => {
  const original = basket()
  const checkedId = markedRice(original)
  const persisted = serializeShoppingListProgress(original, [checkedId])
  const repriced = basket({
    products: m2Products.map((p) =>
      p.id === 'broccoli-500' ? { ...p, priceCents: p.priceCents + 1 } : p),
  })
  assert.equal(repriced.lines.find((line) => line.id === checkedId)?.status, 'matched')
  assert.deepEqual(
    restoreShoppingListProgress(repriced, persisted),
    [checkedId],
    'unrelated price changes must not uncheck a purchased item',
  )
})

test('control: physical store switch cannot reuse an old checked list', () => {
  const original = basket()
  const checkedId = markedRice(original)
  const persisted = serializeShoppingListProgress(original, [checkedId])
  const changedStore = basket({ store: { id: 'other-controlled-store', name: 'Demo B' } })
  assert.notEqual(shoppingListBasketKey(changedStore), shoppingListBasketKey(original))
  assert.deepEqual(restoreShoppingListProgress(changedStore, persisted), [])
})

test('control: changing purchased pack size cannot silently import a checkmark', () => {
  const original = basket()
  const checkedId = markedRice(original)
  const persisted = serializeShoppingListProgress(original, [checkedId])
  const alteredPack = basket({
    products: m2Products.map((p) =>
      p.id === 'basmati-1kg' ? { ...p, packAmount: 0.5 } : p),
  })
  assert.notEqual(shoppingListBasketKey(alteredPack), shoppingListBasketKey(original))
  assert.deepEqual(restoreShoppingListProgress(alteredPack, persisted), [])
})
