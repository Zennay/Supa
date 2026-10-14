import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// #1603/#1564: an update from a newer browser client may arrive AFTER this
// tab opens; never silently downgrade future-schema bytes while saving.
// Fictional M2 basket only, not real retailer observations.
function week() {
  const basket = buildOneStoreBasket({
    store: m2Store, products: m2Products, recipes: m2Recipes,
    plan: m2InitialPlan, activeDays: m2DefaultActiveDays,
  })
  assert.equal(basket.lines.length, 11)
  return basket
}
function port() {
  const values = new Map()
  const writes = []
  return {
    values, writes,
    getItem(k) {
      assert.equal(k, key)
      return values.get(k) ?? null
    },
    setItem(k, raw) {
      assert.equal(k, key)
      writes.push(raw)
      values.set(k, raw)
    },
  }
}

test('M2 full week: future-schema update after open is read-only until same-demand explicit recovery', () => {
  const basket = week()
  const [first, second] = basket.lines.filter((line) => line.status === 'matched')
  const storage = port()
  const tab = openShoppingProgressStorageV2(basket, storage)
  assert.equal(tab.storageFormatStatus(), 'ready')
  tab.toggle(first.id)
  const future = JSON.stringify({
    ...JSON.parse(serializeShoppingProgressV2(basket, [second.id])),
    schemaVersion: 3,
    opaqueFutureFields: { value: 'preserve-me' },
  })
  storage.values.set(key, future)
  assert.equal(tab.persist(), false)
  assert.equal(tab.storageFormatStatus(), 'unknown-record')
  assert.equal(storage.values.get(key), future)
  assert.equal(tab.reloadSaved(), null)
  tab.clear()
  assert.equal(tab.persist(), false)
  assert.equal(storage.values.get(key), future)
  assert.deepEqual(storage.writes, [])
  // A *separate newer client* restores a canonical v2 same-demand record.
  const supported = serializeShoppingProgressV2(basket, [second.id])
  assert.ok(supported)
  storage.values.set(key, supported)
  assert.deepEqual(
    tab.reloadSaved({ requireSameDemand: true })?.completedLineIds,
    [second.id],
  )
  assert.equal(tab.storageFormatStatus(), 'ready')
  tab.toggle(first.id)
  assert.equal(tab.persist(), true)
  assert.deepEqual(JSON.parse(storage.values.get(key)).doneLineIds, [second.id, first.id])
  assert.equal(storage.writes.length, 1)
})

test('M2 full week: duplicate-root schema injected between read and save is never normalized', () => {
  const basket = week()
  const [first] = basket.lines.filter((line) => line.status === 'matched')
  const storage = port()
  const tab = openShoppingProgressStorageV2(basket, storage)
  tab.toggle(first.id)
  const canonical = JSON.parse(serializeShoppingProgressV2(basket, []))
  const duplicate = '{"schemaVersion":2,"schemaVersion":3,"demandIdentity":' +
    JSON.stringify(canonical.demandIdentity) + ',"doneLineIds":[]}'
  storage.values.set(key, duplicate)
  assert.equal(tab.persist(), false)
  assert.equal(tab.storageFormatStatus(), 'unknown-record')
  assert.equal(tab.reloadSaved({ requireSameDemand: true }), null)
  assert.equal(storage.values.get(key), duplicate)
  assert.deepEqual(storage.writes, [])
})
