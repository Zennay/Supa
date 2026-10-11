import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Product-core issues #1564/#1580/#1603: simulate unavailable storage,
// quota/read errors and a separate tab's durable changes. This deliberately
// does NOT assert atomic browser CAS or claim real device acceptance.
const options = {
  store: m2Store, products: m2Products, recipes: m2Recipes, plan: m2InitialPlan,
}
const basket = buildOneStoreBasket({ ...options, activeDays: ['Di'] })
const foreignBasket = buildOneStoreBasket({ ...options, activeDays: ['Di', 'Wo'] })
const lineId = basket.lines.find((line) => line.status === 'matched')?.id
assert.ok(lineId)
const empty = serializeShoppingProgressV2(basket, [])
const ticked = serializeShoppingProgressV2(basket, [lineId])
const foreign = serializeShoppingProgressV2(foreignBasket, [])
assert.ok(empty)
assert.ok(ticked)
assert.ok(foreign)

function transientDisk(initial = empty) {
  const values = new Map([[key, initial]])
  let blockRead = false
  let blockWrite = false
  const writes = []
  return {
    values, writes,
    denyRead(value) { blockRead = value },
    denyWrite(value) { blockWrite = value },
    getItem(k) {
      if (blockRead) throw new Error('test-only access denial')
      return values.get(k) ?? null
    },
    setItem(k, v) {
      if (blockWrite) throw new Error('test-only quota denial')
      writes.push([k, v])
      values.set(k, v)
    },
  }
}

test('Product storage: recover a denied initial read only by deliberate reload', () => {
  const storage = transientDisk(ticked)
  storage.denyRead(true)
  const controller = openShoppingProgressStorageV2(basket, storage)
  assert.equal(controller.storageFormatStatus(), 'unavailable')
  assert.equal(controller.canRetryStorageRead(), true)
  controller.toggle(lineId)
  assert.equal(controller.persist(), false)
  assert.deepEqual(storage.writes, [])
  storage.denyRead(false)
  const recovered = controller.reloadSaved()
  assert.ok(recovered)
  assert.deepEqual(recovered.completedLineIds, [lineId])
  assert.equal(controller.storageFormatStatus(), 'ready')
  assert.equal(storage.values.get(key), ticked)
  assert.deepEqual(storage.writes, [])
})

test('Product storage: failed setItem does not pin a fictitious revision', () => {
  const storage = transientDisk()
  const controller = openShoppingProgressStorageV2(basket, storage)
  controller.toggle(lineId)
  storage.denyWrite(true)
  assert.equal(controller.persist(), false)
  assert.equal(storage.values.get(key), empty)
  assert.deepEqual(controller.snapshot().completedLineIds, [lineId])
  storage.denyWrite(false)
  assert.equal(controller.persist(), true)
  assert.equal(storage.values.get(key), ticked)
  assert.deepEqual(storage.writes, [[key, ticked]])
})

test('Product storage: stale revision after a read denial cannot overwrite other tab', () => {
  const storage = transientDisk()
  const controller = openShoppingProgressStorageV2(basket, storage)
  controller.toggle(lineId)
  storage.denyRead(true)
  assert.equal(controller.persist(), false)
  assert.equal(controller.reloadSaved(), null)
  assert.deepEqual(controller.snapshot().completedLineIds, [lineId])
  storage.denyRead(false)
  storage.values.set(key, ticked)
  assert.equal(controller.persist(), false)
  assert.deepEqual(storage.writes, [])
  assert.ok(controller.reloadSaved())
  assert.deepEqual(controller.snapshot().completedLineIds, [lineId])
  assert.equal(controller.persist(), true)
  assert.equal(storage.values.get(key), ticked)
  assert.deepEqual(storage.writes, [[key, ticked]])
})

test('Product storage: foreign revision after denied write cannot be adopted by reload', () => {
  const storage = transientDisk()
  const controller = openShoppingProgressStorageV2(basket, storage)
  controller.toggle(lineId)
  storage.denyWrite(true)
  assert.equal(controller.persist(), false)
  storage.denyWrite(false)
  storage.values.set(key, foreign)
  assert.equal(controller.reloadSaved(), null)
  assert.deepEqual(controller.snapshot().completedLineIds, [lineId])
  assert.equal(controller.persist(), false)
  assert.equal(storage.values.get(key), foreign)
  assert.deepEqual(storage.writes, [])
})

test('Product storage: absent port remains read-only even after local user toggles', () => {
  const controller = openShoppingProgressStorageV2(basket, null)
  assert.equal(controller.canRetryStorageRead(), false)
  assert.equal(controller.storageFormatStatus(), 'unavailable')
  controller.toggle(lineId)
  assert.deepEqual(controller.snapshot().completedLineIds, [lineId])
  assert.equal(controller.reloadSaved(), null)
  assert.equal(controller.persist(), false)
})
