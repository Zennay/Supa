import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import {
  shoppingListProgressStorageKey,
  serializeShoppingListProgress,
} from '../src/features/shopping-list/shoppingListProgress.ts'
import {
  restoreShoppingProgressV2,
  shoppingListProgressV2StorageKey,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'

// Controlled M2 grocery fixture. No real receipts, price/savings evidence or
// actual browser localStorage migration is claimed from this in-memory port.
function basket() {
  return buildOneStoreBasket({
    store: m2Store, products: m2Products, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays,
  })
}

function storagePort(initial) {
  const data = new Map(initial)
  const reads = []
  const writes = []
  return {
    data, reads, writes,
    port: {
      getItem(key) {
        reads.push(key)
        return data.get(key) ?? null
      },
      setItem(key, value) {
        writes.push([key, value])
        data.set(key, value)
      },
    },
  }
}

test('product migration: default open neither touches v1 nor opts into checked-box import', () => {
  const plan = basket()
  const first = plan.lines[0].id
  const legacy = serializeShoppingListProgress(plan, [first])
  const storage = storagePort([[shoppingListProgressStorageKey, legacy]])
  const controller = openShoppingProgressStorageV2(plan, storage.port)
  assert.deepEqual(controller.snapshot().completedLineIds, [])
  assert.equal(controller.snapshot().upgradedFromLegacy, false)
  assert.deepEqual(storage.reads, [shoppingListProgressV2StorageKey])
  assert.deepEqual(storage.writes, [])
  assert.equal(storage.data.get(shoppingListProgressStorageKey), legacy)
  assert.equal(storage.data.has(shoppingListProgressV2StorageKey), false)
})

test('product migration: explicit matching v1 upgrade remains read-only until an authorized write', () => {
  const plan = basket()
  const checkedId = plan.lines[0].id
  const legacy = serializeShoppingListProgress(plan, [checkedId])
  const frozen = structuredClone(plan)
  const storage = storagePort([[shoppingListProgressStorageKey, legacy]])
  const controller = openShoppingProgressStorageV2(
    plan, storage.port, { allowLegacyUpgrade: true },
  )
  assert.deepEqual(controller.snapshot().completedLineIds, [checkedId])
  assert.equal(controller.snapshot().upgradedFromLegacy, true)
  assert.deepEqual(storage.reads, [
    shoppingListProgressV2StorageKey, shoppingListProgressStorageKey,
  ])
  assert.deepEqual(storage.writes, [])
  assert.equal(storage.data.has(shoppingListProgressV2StorageKey), false)

  assert.equal(controller.persist(), true)
  assert.deepEqual(restoreShoppingProgressV2(
    plan, storage.data.get(shoppingListProgressV2StorageKey),
  ), [checkedId])
  assert.deepEqual(storage.writes.map(([key]) => key), [shoppingListProgressV2StorageKey])
  assert.equal(storage.data.get(shoppingListProgressStorageKey), legacy)
  assert.deepEqual(plan, frozen)
})

test('product migration: a price-only v1 mismatch never promotes stale ticks into v2', () => {
  const oldBasket = basket()
  const checkedId = oldBasket.lines[0].id
  const staleLegacy = serializeShoppingListProgress(oldBasket, [checkedId])
  const updated = structuredClone(oldBasket)
  const priced = updated.lines.find(line => line.status === 'matched')
  assert.ok(priced)
  priced.pricePerPackCents += 4
  priced.lineTotalCents += 4 * priced.packs
  updated.totalCents += 4 * priced.packs

  const storage = storagePort([[shoppingListProgressStorageKey, staleLegacy]])
  const controller = openShoppingProgressStorageV2(
    updated, storage.port, { allowLegacyUpgrade: true },
  )
  assert.equal(controller.snapshot().upgradedFromLegacy, false)
  assert.deepEqual(controller.snapshot().completedLineIds, [])
  assert.deepEqual(storage.writes, [])
  assert.equal(storage.data.has(shoppingListProgressV2StorageKey), false)
  assert.equal(storage.data.get(shoppingListProgressStorageKey), staleLegacy)
})

test('product migration: a present unknown v2 envelope blocks legacy fallback and all new writes', () => {
  const plan = basket()
  const checkedId = plan.lines[0].id
  const legacy = serializeShoppingListProgress(plan, [checkedId])
  const unknownV2 = JSON.stringify({
    schemaVersion: 3, revision: 'future-only',
    demandIdentity: 'future-new-scheme', doneLineIds: [checkedId],
  })
  const storage = storagePort([
    [shoppingListProgressStorageKey, legacy],
    [shoppingListProgressV2StorageKey, unknownV2],
  ])
  const controller = openShoppingProgressStorageV2(
    plan, storage.port, { allowLegacyUpgrade: true },
  )
  assert.equal(controller.storageFormatStatus(), 'unknown-record')
  assert.deepEqual(controller.snapshot().completedLineIds, [])
  assert.deepEqual(storage.reads, [shoppingListProgressV2StorageKey])
  controller.toggle(checkedId)
  assert.equal(controller.persist(), false)
  assert.equal(storage.data.get(shoppingListProgressStorageKey), legacy)
  assert.equal(storage.data.get(shoppingListProgressV2StorageKey), unknownV2)
  assert.deepEqual(storage.writes, [])
})
