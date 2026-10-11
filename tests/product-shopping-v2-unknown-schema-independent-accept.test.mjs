import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as v2Key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

function basketFixture() {
  const basket = buildOneStoreBasket({
    store: m2Store,
    products: m2Products,
    plan: m2InitialPlan,
    activeDays: ['Di'],
    recipes: m2Recipes,
  })
  const rows = basket.lines.filter((line) => line.status === 'matched')
  assert.ok(rows.length >= 2)
  return { basket, first: rows[0].id, second: rows[1].id }
}

function port(initial) {
  const data = new Map()
  if (initial !== null) data.set(v2Key, initial)
  let writes = 0
  return {
    data,
    get writes() { return writes },
    getItem(key) { return data.get(key) ?? null },
    setItem(key, value) { writes++; data.set(key, value) },
  }
}

test('independent product acceptance: unknown future version cannot be pinned by manual reload', () => {
  const { basket, first } = basketFixture()
  const future = JSON.stringify({
    schemaVersion: 4,
    demandIdentity: 'opaque-future-physical-task',
    doneLineIds: [first],
    futureMetadata: { preserve: 'synthetic' },
  })
  const storage = port(future)
  const controller = openShoppingProgressStorageV2(basket, storage)
  assert.equal(controller.reloadSaved(), null, 'manual reload must not accept unrecognized future schema')
  controller.toggle(first)
  assert.equal(controller.persist(), false)
  assert.equal(storage.writes, 0)
  assert.equal(storage.data.get(v2Key), future)
  assert.deepEqual(controller.snapshot().completedLineIds, [first])
})

test('independent product acceptance: recognized empty storage permits intentional recovery after v3 removal', () => {
  const { basket, first } = basketFixture()
  const future = JSON.stringify({ schemaVersion: 3, doneLineIds: [first] })
  const storage = port(future)
  const controller = openShoppingProgressStorageV2(basket, storage)
  controller.toggle(first)
  assert.equal(controller.persist(), false)
  storage.data.delete(v2Key) // external user action; controller does not erase unknown bytes
  assert.deepEqual(controller.reloadSaved()?.completedLineIds, [])
  controller.toggle(first)
  assert.equal(controller.persist(), true)
  assert.deepEqual(openShoppingProgressStorageV2(basket, storage).snapshot().completedLineIds, [first])
  assert.equal(storage.writes, 1)
})

test('independent product acceptance: replaced unknown data only recovers recognized matching v2', () => {
  const { basket, first, second } = basketFixture()
  const storage = port('not-json')
  const controller = openShoppingProgressStorageV2(basket, storage)
  controller.toggle(first)
  assert.equal(controller.persist(), false)

  // Another client writes a well-formed record for the same physical task.
  const valid = serializeShoppingProgressV2(basket, [second])
  assert.ok(valid)
  storage.data.set(v2Key, valid)
  assert.deepEqual(controller.reloadSaved()?.completedLineIds, [second])
  assert.equal(storage.data.get(v2Key), valid, 'reload is read-only')
  controller.toggle(first)
  assert.equal(controller.persist(), true)
  assert.deepEqual(
    openShoppingProgressStorageV2(basket, storage).snapshot().completedLineIds,
    [second, first],
  )
  assert.equal(storage.writes, 1)
})

test('independent product acceptance: an in-flight different schema cannot be overwritten after starting empty', () => {
  const { basket, first } = basketFixture()
  const storage = port(null)
  const controller = openShoppingProgressStorageV2(basket, storage)
  controller.toggle(first)
  const future = JSON.stringify({ schemaVersion: 3, content: 'synthetic third-party' })
  storage.data.set(v2Key, future)
  assert.equal(controller.persist(), false)
  assert.equal(controller.reloadSaved(), null)
  assert.equal(storage.data.get(v2Key), future)
  assert.equal(storage.writes, 0)
})

test('independent product acceptance: valid foreign v2 is not mistaken for future schema', () => {
  const { basket, first } = basketFixture()
  const foreign = structuredClone(basket)
  foreign.store.id = 'synthetic-other-shop'
  const stored = serializeShoppingProgressV2(foreign, [first])
  assert.ok(stored)
  const storage = port(stored)
  const current = openShoppingProgressStorageV2(basket, storage)
  current.toggle(first)
  assert.equal(current.persist(), true, 'user may intentionally switch recognized shopping tasks')
  assert.deepEqual(openShoppingProgressStorageV2(basket, storage).snapshot().completedLineIds, [first])
})
