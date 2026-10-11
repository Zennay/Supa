import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { shoppingListProgressStorageKey } from '../src/features/shopping-list/shoppingListProgress.ts'

const build = (products = m2Products, store = m2Store) => buildOneStoreBasket({
  store,
  products,
  plan: m2InitialPlan,
  activeDays: m2InitialPlan.map(({ day }) => day),
  recipes: m2Recipes,
})

function storagePort() {
  const data = new Map()
  const writes = []
  return {
    data,
    writes,
    getItem(key) { return data.get(key) ?? null },
    setItem(key, value) { writes.push([key, value]); data.set(key, value) },
  }
}

test('full-week second shopping round never resurrects previous checked tasks after a price-only refresh', () => {
  const initial = build()
  const matched = initial.lines.filter((line) => line.status === 'matched')
  assert.ok(matched.length >= 3)
  const [first, second, third] = matched
  const storage = storagePort()
  const legacy = '{"schemaVersion":1,"legacy":"leave-untouched"}'
  storage.data.set(shoppingListProgressStorageKey, legacy)

  const controller = openShoppingProgressStorageV2(initial, storage)
  assert.deepEqual(controller.toggle(first.id).completedLineIds, [first.id])
  assert.deepEqual(controller.toggle(second.id).completedLineIds, [first.id, second.id])
  assert.equal(controller.persist(), true)

  const oldRecord = storage.data.get(shoppingListProgressV2StorageKey)
  const repriced = build(m2Products.map((product) => ({
    ...product,
    priceCents: product.priceCents + 1,
  })))
  assert.notEqual(repriced.totalCents, initial.totalCents)
  assert.deepEqual(controller.rebase(repriced).completedLineIds, [first.id, second.id])
  const reordered = structuredClone(repriced)
  reordered.lines.reverse()
  assert.deepEqual(controller.rebase(reordered).completedLineIds, [first.id, second.id])

  const beforeClear = storage.writes.length
  const cleared = controller.clear()
  assert.deepEqual(cleared.completedLineIds, [])
  assert.deepEqual(JSON.parse(cleared.serialized).doneLineIds, [])
  assert.equal(storage.writes.length, beforeClear, 'a clear needs a deliberate persist')
  assert.equal(controller.persist(), true)

  assert.notEqual(storage.data.get(shoppingListProgressV2StorageKey), oldRecord)
  assert.deepEqual(
    openShoppingProgressStorageV2(initial, storage).snapshot().completedLineIds,
    [],
    'returning to the former valid price cannot revive earlier checkmarks',
  )
  assert.deepEqual(
    openShoppingProgressStorageV2(repriced, storage).snapshot().completedLineIds,
    [],
  )

  // A fresh round is not permanently disabled: new shopping actions can save.
  assert.deepEqual(controller.toggle(third.id).completedLineIds, [third.id])
  assert.equal(controller.persist(), true)
  assert.deepEqual(
    openShoppingProgressStorageV2(repriced, storage).snapshot().completedLineIds,
    [third.id],
  )
  assert.equal(storage.writes.length, beforeClear + 2)
  assert.ok(storage.writes.every(([key]) => key === shoppingListProgressV2StorageKey))
  assert.equal(storage.data.get(shoppingListProgressStorageKey), legacy)
})

test('changing the shop between two rounds drops stale completion before a new empty v2 record is saved', () => {
  const initial = build()
  const row = initial.lines.find((line) => line.status === 'matched')
  assert.ok(row)
  const storage = storagePort()
  const controller = openShoppingProgressStorageV2(initial, storage)
  controller.toggle(row.id)
  assert.equal(controller.persist(), true)

  const foreign = build(
    m2Products.map((product) => ({ ...product, storeId: 'another-store' })),
    { id: 'another-store', name: 'Another synthetic store' },
  )
  assert.deepEqual(controller.rebase(foreign).completedLineIds, [])
  assert.deepEqual(controller.clear().completedLineIds, [])
  assert.equal(controller.persist(), true)
  assert.deepEqual(openShoppingProgressStorageV2(foreign, storage).snapshot().completedLineIds, [])
  assert.deepEqual(openShoppingProgressStorageV2(initial, storage).snapshot().completedLineIds, [])
  assert.deepEqual(JSON.parse(storage.data.get(shoppingListProgressV2StorageKey)).doneLineIds, [])
})
