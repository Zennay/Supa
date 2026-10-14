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

// #1056/#1564/#1603 — physical-task progress must survive an explicit
// recovery without inventing completed groceries or overwriting newer tabs.
// Canonical synthetic 4-meal / 11-demand week only; no observed retailer prices.
function weekBasket() {
  const basket = buildOneStoreBasket({
    store: m2Store, products: m2Products, recipes: m2Recipes,
    plan: m2InitialPlan, activeDays: m2DefaultActiveDays,
  })
  assert.equal(basket.lines.length, 11)
  return basket
}

function storage(initial = null) {
  const values = new Map()
  if (initial !== null) values.set(key, initial)
  const writes = []
  let denied = false
  return {
    values, writes,
    deny(shouldDeny) { denied = shouldDeny },
    getItem(name) {
      assert.equal(name, key, 'recovery must not import legacy v1')
      if (denied) throw new Error('controlled unavailable storage')
      return values.get(name) ?? null
    },
    setItem(name, value) {
      assert.equal(name, key)
      if (denied) throw new Error('controlled unavailable storage')
      writes.push(value)
      values.set(name, value)
    },
  }
}

function completed(raw) {
  assert.equal(typeof raw, 'string')
  const record = JSON.parse(raw)
  assert.equal(record.schemaVersion, 2)
  return record.doneLineIds
}

test('M2 full-week: initially denied read recovers an already-saved same-demand checklist only on explicit reload', () => {
  const week = weekBasket()
  const [first, second] = week.lines.filter((line) => line.status === 'matched')
  const saved = serializeShoppingProgressV2(week, [first.id])
  assert.ok(saved)
  const disk = storage(saved)
  disk.deny(true)
  const tab = openShoppingProgressStorageV2(week, disk)
  assert.equal(tab.storageFormatStatus(), 'unavailable')
  assert.equal(tab.canRetryStorageRead(), true)
  tab.toggle(second.id)
  assert.equal(tab.persist(), false)
  assert.equal(disk.values.get(key), saved)
  disk.deny(false)
  // A deliberate read discards stale in-memory ticks rather than combining
  // conflicting snapshots and manufacturing a durable completion claim.
  assert.deepEqual(tab.reloadSaved()?.completedLineIds, [first.id])
  assert.equal(tab.storageFormatStatus(), 'ready')
  tab.toggle(second.id)
  assert.equal(tab.persist(), true)
  assert.deepEqual(completed(disk.values.get(key)), [first.id, second.id])
  assert.equal(disk.writes.length, 1)
})

test('M2 full-week: conflict followed by denied reload cannot overwrite newer checklist on retry', () => {
  const week = weekBasket()
  const [first, second] = week.lines.filter((line) => line.status === 'matched')
  const disk = storage()
  const a = openShoppingProgressStorageV2(week, disk)
  const b = openShoppingProgressStorageV2(week, disk)
  a.toggle(first.id)
  assert.equal(a.persist(), true)
  const firstRevision = disk.values.get(key)
  b.toggle(second.id)
  assert.equal(b.persist(), false)
  disk.deny(true)
  assert.equal(b.reloadSaved(), null)
  assert.equal(b.persist(), false)
  disk.deny(false)
  assert.equal(disk.values.get(key), firstRevision)
  assert.deepEqual(b.reloadSaved()?.completedLineIds, [first.id])
  b.toggle(second.id)
  assert.equal(b.persist(), true)
  assert.deepEqual(completed(disk.values.get(key)), [first.id, second.id])
  assert.equal(disk.writes.length, 2)
})

test('M2 full-week: a null storage port never treats local checkmarks as durable', () => {
  const week = weekBasket()
  const [first] = week.lines.filter((line) => line.status === 'matched')
  const tab = openShoppingProgressStorageV2(week, null)
  assert.equal(tab.canRetryStorageRead(), false)
  assert.equal(tab.storageFormatStatus(), 'unavailable')
  assert.deepEqual(tab.toggle(first.id).completedLineIds, [first.id])
  assert.equal(tab.persist(), false)
  assert.equal(tab.reloadSaved(), null)
  assert.deepEqual(tab.snapshot().completedLineIds, [first.id])
  tab.clear()
  assert.deepEqual(tab.snapshot().completedLineIds, [])
  assert.equal(tab.persist(), false)
})
