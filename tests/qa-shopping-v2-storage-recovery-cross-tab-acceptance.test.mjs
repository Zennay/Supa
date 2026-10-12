import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'

function basket() {
  return buildOneStoreBasket({
    store: { ...m2Store },
    plan: m2InitialPlan,
    recipes: m2Recipes,
    products: m2Products,
    activeDays: ['Di'],
  })
}

test('QA #1603: a temporarily denied first storage read requires explicit recovery before writing', () => {
  const current = basket()
  const id = current.lines[0].id
  const data = new Map()
  let denyFirstRead = true
  const writes = []
  const storage = {
    getItem(key) {
      if (denyFirstRead) {
        denyFirstRead = false
        throw new Error('synthetic private-mode read denial')
      }
      return data.get(key) ?? null
    },
    setItem(key, value) { writes.push([key, value]); data.set(key, value) },
  }
  const controller = openShoppingProgressStorageV2(current, storage)
  assert.equal(controller.storageFormatStatus(), 'unavailable')
  controller.toggle(id)
  assert.equal(controller.persist(), false)
  assert.deepEqual(writes, [])

  const afterManualRecovery = controller.reloadSaved({ requireSameDemand: true })
  assert.ok(afterManualRecovery, 'a deliberate successful read must be required')
  assert.equal(controller.storageFormatStatus(), 'ready')
  assert.deepEqual(afterManualRecovery.completedLineIds, [])
  assert.deepEqual(writes, [], 'recovery is a read-only action')

  controller.toggle(id)
  assert.equal(controller.persist(), true)
  assert.equal(writes.length, 1)
  assert.equal(writes[0][0], shoppingListProgressV2StorageKey)
  assert.deepEqual(JSON.parse(writes[0][1]).doneLineIds, [id])
})

test('QA #1603: an external future-schema overwrite blocks stale-tab saves and recovery', () => {
  const current = basket()
  const data = new Map()
  const writes = []
  const storage = {
    getItem(key) { return data.get(key) ?? null },
    setItem(key, value) { writes.push([key, value]); data.set(key, value) },
  }
  const oldTab = openShoppingProgressStorageV2(current, storage)
  oldTab.toggle(current.lines[0].id)
  const futureBytes = '{"schemaVersion":3,"newClient":"do-not-overwrite"}'
  data.set(shoppingListProgressV2StorageKey, futureBytes)

  assert.equal(oldTab.persist(), false)
  assert.equal(oldTab.storageFormatStatus(), 'unknown-record')
  assert.equal(oldTab.reloadSaved({ requireSameDemand: true }), null)
  assert.equal(oldTab.persist(), false)
  assert.deepEqual(writes, [])
  assert.equal(data.get(shoppingListProgressV2StorageKey), futureBytes)
})

test('QA #1603: a canonical foreign physical checklist is replaceable on a fresh explicit save', () => {
  const current = basket()
  const other = structuredClone(current)
  other.store.id = 'synthetic-other-retailer'
  other.store.name = 'Fictieve andere winkel'
  const foreignBytes = serializeShoppingProgressV2(other, [other.lines[0].id])
  assert.equal(typeof foreignBytes, 'string')
  const data = new Map([[shoppingListProgressV2StorageKey, foreignBytes]])
  const writes = []
  const storage = {
    getItem(key) { return data.get(key) ?? null },
    setItem(key, value) { writes.push([key, value]); data.set(key, value) },
  }
  const controller = openShoppingProgressStorageV2(current, storage)
  assert.equal(controller.storageFormatStatus(), 'ready')
  assert.deepEqual(controller.snapshot().completedLineIds, [])
  assert.deepEqual(writes, [], 'opening an unrelated valid physical task cannot write')
  controller.toggle(current.lines[0].id)
  assert.equal(controller.persist(), true, 'an explicit new task is allowed')
  assert.equal(writes.length, 1)
  assert.deepEqual(JSON.parse(writes[0][1]).doneLineIds, [current.lines[0].id])
  assert.notEqual(data.get(shoppingListProgressV2StorageKey), foreignBytes)
})

test('QA #1603: a purported foreign task with an unknown completion cannot be silently discarded', () => {
  const current = basket()
  const other = structuredClone(current)
  other.store.id = 'synthetic-other-retailer'
  other.store.name = 'Fictieve andere winkel'
  const valid = serializeShoppingProgressV2(other, [other.lines[0].id])
  assert.equal(typeof valid, 'string')
  const badForeign = JSON.stringify({
    ...JSON.parse(valid),
    doneLineIds: ['not-a-line-in-the-foreign-basket'],
  })
  const data = new Map([[shoppingListProgressV2StorageKey, badForeign]])
  const writes = []
  const storage = {
    getItem(key) { return data.get(key) ?? null },
    setItem(key, value) { writes.push([key, value]); data.set(key, value) },
  }
  const controller = openShoppingProgressStorageV2(current, storage)
  controller.toggle(current.lines[0].id)
  assert.equal(controller.persist(), false)
  assert.equal(controller.storageFormatStatus(), 'unknown-record')
  assert.deepEqual(writes, [])
  assert.equal(data.get(shoppingListProgressV2StorageKey), badForeign)
})
