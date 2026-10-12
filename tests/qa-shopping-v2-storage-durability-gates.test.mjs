import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { shoppingListProgressStorageKey } from '../src/features/shopping-list/shoppingListProgress.ts'

function basket() {
  return buildOneStoreBasket({
    store: { ...m2Store },
    plan: m2InitialPlan,
    recipes: m2Recipes,
    products: m2Products,
    activeDays: ['Di'],
  })
}

function memoryStorage() {
  const records = new Map()
  const reads = []
  const writes = []
  return {
    records, reads, writes,
    storage: {
      getItem(key) {
        reads.push(key)
        return records.get(key) ?? null
      },
      setItem(key, value) {
        writes.push([key, value])
        records.set(key, value)
      },
    },
  }
}

test('QA: shopping-v2 opening and expired physical task cannot persist stale ticks', () => {
  const physical = basket()
  const source = structuredClone(physical)
  const line = physical.lines[0]
  const port = memoryStorage()
  const controller = openShoppingProgressStorageV2(physical, port.storage)

  assert.deepEqual(port.writes, [], 'initial render-side opening must be read-only')
  assert.equal(controller.storageFormatStatus(), 'ready')
  controller.toggle(line.id)
  physical.store.id = 'synthetic-changed-retailer'
  assert.equal(controller.persist(), false)
  assert.deepEqual(port.writes, [])
  assert.equal(port.records.has(shoppingListProgressV2StorageKey), false)
  assert.equal(shoppingListProgressV2StorageKey in source, false)
})

test('QA: explicit price-only shopping-v2 progress save stores IDs, not money or legacy migration', () => {
  const physical = basket()
  const source = structuredClone(physical)
  const port = memoryStorage()
  port.records.set(shoppingListProgressStorageKey, 'opaque-legacy-v1')
  const controller = openShoppingProgressStorageV2(physical, port.storage)
  const id = physical.lines[0].id

  physical.totalCents += 137
  controller.toggle(id)
  assert.equal(controller.persist(), true)
  assert.equal(port.writes.length, 1)
  assert.equal(port.writes[0][0], shoppingListProgressV2StorageKey)
  assert.equal(port.records.get(shoppingListProgressStorageKey), 'opaque-legacy-v1')
  const record = JSON.parse(port.writes[0][1])
  assert.equal(record.schemaVersion, 2)
  assert.deepEqual(record.doneLineIds, [id])
  assert.equal(typeof record.demandIdentity, 'string')
  assert.doesNotMatch(port.writes[0][1], /totalCents|priceCents|participantKey/)
  assert.deepEqual(port.reads, [
    shoppingListProgressV2StorageKey, shoppingListProgressV2StorageKey,
  ])
  assert.deepEqual(source, basket())
})

test('QA: a stale-tab save cannot overwrite newer v2 progress and recovery never writes', () => {
  const physical = basket()
  const port = memoryStorage()
  const first = openShoppingProgressStorageV2(physical, port.storage)
  const stale = openShoppingProgressStorageV2(physical, port.storage)
  const id = physical.lines[0].id
  first.toggle(id)
  assert.equal(first.persist(), true)
  const newestBytes = port.records.get(shoppingListProgressV2StorageKey)
  assert.equal(typeof newestBytes, 'string')
  assert.equal(port.writes.length, 1)

  stale.toggle(id)
  assert.equal(stale.persist(), false)
  assert.equal(port.records.get(shoppingListProgressV2StorageKey), newestBytes)
  assert.equal(port.writes.length, 1)
  const restored = stale.reloadSaved()
  assert.ok(restored)
  assert.deepEqual(restored.completedLineIds, [id])
  assert.equal(port.records.get(shoppingListProgressV2StorageKey), newestBytes)
  assert.equal(port.writes.length, 1)
})
