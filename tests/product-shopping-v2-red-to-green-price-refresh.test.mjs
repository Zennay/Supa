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
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { serializeShoppingListProgress, shoppingListProgressStorageKey } from '../src/features/shopping-list/shoppingListProgress.ts'
import { shoppingListRowsV2 } from '../src/features/shopping-list/shoppingListRowsV2.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Postrepair verification of the SAME two synthetic +1-cent regressions that
// fail on original v1 main in PR #1774. Does not change owner source or v1 data.
function completeWeek({ products = m2Products, store = m2Store } = {}) {
  return buildOneStoreBasket({
    store, products,
    plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
  })
}

function port(initial = []) {
  const data = new Map(initial)
  const writes = []
  return {
    data, writes,
    getItem(key) { return data.get(key) ?? null },
    setItem(key, raw) { writes.push([key, raw]); data.set(key, raw) },
  }
}

function riceLine(basket) {
  const line = basket.lines.find((row) => row.id === 'basmati-rice')
  assert.ok(line)
  assert.equal(line.status, 'matched')
  return line
}

function withPriceChange(productId) {
  return completeWeek({
    products: m2Products.map((product) =>
      product.id === productId
        ? { ...product, priceCents: product.priceCents + 1 }
        : product),
  })
}

function checkedRiceController(basket, storage) {
  const original = openShoppingProgressStorageV2(basket, storage)
  const checked = riceLine(basket)
  original.toggle(checked.id)
  assert.equal(original.persist(), true)
  return original
}

test('v2 end-to-end: +1-cent selected rice refresh keeps persisted check without new write', () => {
  const original = completeWeek()
  const storage = port()
  const controller = checkedRiceController(original, storage)
  const before = riceLine(original)
  const repriced = withPriceChange('basmati-1kg')
  const after = riceLine(repriced)
  assert.equal(after.productId, before.productId)
  assert.equal(after.packs, before.packs)
  assert.deepEqual(after.requirement, before.requirement)
  assert.equal(after.pricePerPackCents - before.pricePerPackCents, 1)
  assert.equal(shoppingListDemandIdentity(repriced), shoppingListDemandIdentity(original))

  const priorWrites = storage.writes.length
  const state = controller.rebase(repriced)
  assert.deepEqual(state.completedLineIds, [before.id])
  assert.deepEqual(shoppingListRowsV2(repriced, state).filter((row) => row.checked).map((row) => row.id), [before.id])
  assert.equal(storage.writes.length, priorWrites, 'price-only display changes never write automatically')
  assert.deepEqual(
    openShoppingProgressStorageV2(repriced, storage).snapshot().completedLineIds,
    [before.id],
    'reload restores checked physical demand after selected price update',
  )
})

test('v2 end-to-end: +1-cent unrelated broccoli refresh also retains checked rice', () => {
  const original = completeWeek()
  const storage = port()
  checkedRiceController(original, storage)
  const repriced = withPriceChange('broccoli-500')
  assert.notEqual(original.totalCents, repriced.totalCents)
  assert.equal(shoppingListDemandIdentity(repriced), shoppingListDemandIdentity(original))
  assert.deepEqual(openShoppingProgressStorageV2(repriced, storage).snapshot().completedLineIds, ['basmati-rice'])
})

test('v2: real physical pack-size change fails closed and does not import rice completion', () => {
  const original = completeWeek()
  const storage = port()
  const controller = checkedRiceController(original, storage)
  const changed = completeWeek({
    products: m2Products.map((product) =>
      product.id === 'basmati-1kg'
        ? { ...product, packAmount: 0.5 }
        : product),
  })
  assert.notEqual(shoppingListDemandIdentity(changed), shoppingListDemandIdentity(original))
  assert.deepEqual(controller.rebase(changed).completedLineIds, [])
  assert.deepEqual(openShoppingProgressStorageV2(changed, storage).snapshot().completedLineIds, [])
})

test('v2: store switch does not import completed rows from first store', () => {
  const original = completeWeek()
  const storage = port()
  const controller = checkedRiceController(original, storage)
  const secondStore = completeWeek({ store: { id: 'different-demo-store', name: 'Demo B' } })
  assert.notEqual(shoppingListDemandIdentity(secondStore), shoppingListDemandIdentity(original))
  assert.deepEqual(controller.rebase(secondStore).completedLineIds, [])
  assert.ok(shoppingListRowsV2(secondStore, controller.snapshot()).every((row) => !row.checked))
})

test('v2: legacy v1 is neither silently migrated nor deleted after price-only refresh', () => {
  const initial = completeWeek()
  const legacy = serializeShoppingListProgress(initial, ['basmati-rice'])
  const storage = port([[shoppingListProgressStorageKey, legacy]])
  const controller = openShoppingProgressStorageV2(withPriceChange('basmati-1kg'), storage)
  assert.deepEqual(controller.snapshot().completedLineIds, [])
  assert.equal(controller.snapshot().upgradedFromLegacy, false)
  assert.equal(storage.data.get(shoppingListProgressStorageKey), legacy)
  assert.equal(storage.data.has(shoppingListProgressV2StorageKey), false)
  assert.deepEqual(storage.writes, [])
})

test('v2: price-refresh after a conflicting tab update cannot overwrite newer checks', () => {
  const original = completeWeek()
  const storage = port()
  const firstTab = openShoppingProgressStorageV2(original, storage)
  const staleTab = openShoppingProgressStorageV2(original, storage)
  firstTab.toggle('basmati-rice')
  assert.equal(firstTab.persist(), true)
  const durable = storage.data.get(shoppingListProgressV2StorageKey)
  staleTab.rebase(withPriceChange('basmati-1kg'))
  const nextLine = original.lines.find((line) => line.id !== 'basmati-rice')
  assert.ok(nextLine)
  staleTab.toggle(nextLine.id)
  assert.equal(staleTab.persist(), false)
  assert.equal(storage.data.get(shoppingListProgressV2StorageKey), durable)
  assert.deepEqual(
    openShoppingProgressStorageV2(original, storage).snapshot().completedLineIds,
    ['basmati-rice'],
  )
})
