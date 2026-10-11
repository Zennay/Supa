import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey as key } from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Product-core #1564: explicit reset is a write, NOT permission to clobber
// another tab's newer checklist. Only synthetic M2 week data; no live prices.
function basket() {
  const value = buildOneStoreBasket({
    store: m2Store, products: m2Products, recipes: m2Recipes,
    plan: m2InitialPlan, activeDays: m2DefaultActiveDays,
  })
  assert.equal(value.lines.length, 11)
  assert.ok(value.lines.filter((line) => line.status === 'matched').length >= 3)
  return value
}

function memoryStorage() {
  const values = new Map()
  const writes = []
  return {
    values, writes,
    getItem(k) {
      assert.equal(k, key, 'v2 controller must not access legacy v1 unexpectedly')
      return values.get(k) ?? null
    },
    setItem(k, value) {
      assert.equal(k, key)
      writes.push(value)
      values.set(k, value)
    },
  }
}

function selected(saved) {
  assert.equal(typeof saved, 'string')
  const parsed = JSON.parse(saved)
  assert.equal(parsed.schemaVersion, 2)
  return parsed.doneLineIds
}

test('M2 eleven-demand round: stale explicit clear cannot delete another tab checkmark', () => {
  const week = basket()
  const [first] = week.lines.filter((line) => line.status === 'matched')
  const disk = memoryStorage()
  const firstTab = openShoppingProgressStorageV2(week, disk)
  const secondTab = openShoppingProgressStorageV2(week, disk)
  firstTab.toggle(first.id)
  assert.equal(firstTab.persist(), true)
  const newer = disk.values.get(key)
  secondTab.clear()
  assert.deepEqual(secondTab.snapshot().completedLineIds, [])
  assert.equal(secondTab.persist(), false)
  assert.equal(disk.values.get(key), newer)
  assert.deepEqual(selected(newer), [first.id])
  assert.equal(disk.writes.length, 1)
  assert.deepEqual(secondTab.reloadSaved()?.completedLineIds, [first.id])
  secondTab.clear()
  assert.equal(secondTab.persist(), true, 'clear is allowed after explicit reload')
  assert.deepEqual(selected(disk.values.get(key)), [])
  assert.equal(disk.writes.length, 2)
})

test('M2 eleven-demand round: stale tab must not revive intentionally cleared checks', () => {
  const week = basket()
  const [first, second] = week.lines.filter((line) => line.status === 'matched')
  const disk = memoryStorage()
  const owner = openShoppingProgressStorageV2(week, disk)
  owner.toggle(first.id)
  assert.equal(owner.persist(), true)
  const stale = openShoppingProgressStorageV2(week, disk)
  owner.clear()
  assert.equal(owner.persist(), true)
  const cleared = disk.values.get(key)
  assert.deepEqual(selected(cleared), [])
  stale.toggle(second.id)
  assert.equal(stale.persist(), false)
  assert.equal(disk.values.get(key), cleared, 'stale tab cannot resurrect cleared list')
  assert.deepEqual(stale.reloadSaved()?.completedLineIds, [])
  stale.toggle(second.id)
  assert.equal(stale.persist(), true)
  assert.deepEqual(selected(disk.values.get(key)), [second.id])
  assert.equal(disk.writes.length, 3)
})

test('M2 eleven-demand round: price-only rebase never excuses stale concurrent clear', () => {
  const week = basket()
  const [first, second] = week.lines.filter((line) => line.status === 'matched')
  const disk = memoryStorage()
  const owner = openShoppingProgressStorageV2(week, disk)
  owner.toggle(first.id)
  assert.equal(owner.persist(), true)
  const stale = openShoppingProgressStorageV2(week, disk)
  owner.clear()
  assert.equal(owner.persist(), true)
  const cleared = disk.values.get(key)
  // Valid price-only refresh; pack and physical demand remain unchanged.
  const refreshed = {
    ...week,
    totalCents: week.totalCents + first.packs,
    lines: week.lines.map((line) => line.id === first.id
      ? {
          ...line, pricePerPackCents: line.pricePerPackCents + 1,
          lineTotalCents: line.lineTotalCents + line.packs,
        }
      : line),
  }
  assert.deepEqual(stale.rebase(refreshed).completedLineIds, [first.id])
  stale.toggle(second.id)
  assert.equal(stale.persist(), false)
  assert.equal(disk.values.get(key), cleared)
  assert.deepEqual(stale.reloadSaved()?.completedLineIds, [])
  stale.toggle(second.id)
  assert.equal(stale.persist(), true)
  assert.deepEqual(selected(disk.values.get(key)), [second.id])
})

test('M2 eleven-demand round: foreign store rebase cannot overwrite newer saved task', () => {
  const week = basket()
  const [first] = week.lines.filter((line) => line.status === 'matched')
  const disk = memoryStorage()
  const tabA = openShoppingProgressStorageV2(week, disk)
  const tabB = openShoppingProgressStorageV2(week, disk)
  tabA.toggle(first.id)
  assert.equal(tabA.persist(), true)
  const original = disk.values.get(key)
  const foreign = { ...week, store: { ...week.store, id: 'controlled-other-store' } }
  assert.deepEqual(tabB.rebase(foreign).completedLineIds, [])
  assert.equal(tabB.persist(), false)
  assert.equal(disk.values.get(key), original)
  assert.equal(tabB.reloadSaved(), null, 'failed save cannot adopt a foreign basket')
  assert.equal(disk.writes.length, 1)
  // A deliberate return to the original physical store permits a safe reload.
  tabB.rebase(week)
  assert.deepEqual(tabB.reloadSaved()?.completedLineIds, [first.id])
  assert.deepEqual(selected(disk.values.get(key)), [first.id])
})
