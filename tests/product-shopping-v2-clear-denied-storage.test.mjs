import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey as v2Key } from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Product #1564: no phantom durable success after denied writes/reads.
// Synthetic fixture only, not a retailer quote or real savings outcome.
function fullWeek() {
  const value = buildOneStoreBasket({
    store: m2Store, products: m2Products, recipes: m2Recipes,
    plan: m2InitialPlan, activeDays: m2DefaultActiveDays,
  })
  assert.equal(value.lines.length, 11)
  return value
}
function port() {
  const saved = new Map()
  const writes = []
  let failRead = false
  let failWrite = false
  return {
    saved, writes,
    denyReads(yes) { failRead = yes },
    denyWrites(yes) { failWrite = yes },
    getItem(key) {
      assert.equal(key, v2Key)
      if (failRead) throw new Error('test-only private storage denial')
      return saved.get(key) ?? null
    },
    setItem(key, value) {
      assert.equal(key, v2Key)
      if (failWrite) throw new Error('test-only quota exceeded')
      writes.push(value)
      saved.set(key, value)
    },
  }
}
function done(raw) {
  assert.equal(typeof raw, 'string')
  return JSON.parse(raw).doneLineIds
}

test('full M2 week: quota-denied clear retains newer ticks until manual recovery', () => {
  const week = fullWeek()
  const [first, second] = week.lines.filter((line) => line.status === 'matched')
  const disk = port()
  const a = openShoppingProgressStorageV2(week, disk)
  a.toggle(first.id)
  assert.equal(a.persist(), true)
  const b = openShoppingProgressStorageV2(week, disk)
  b.clear()
  disk.denyWrites(true)
  assert.equal(b.persist(), false)
  disk.denyWrites(false)
  assert.deepEqual(done(disk.saved.get(v2Key)), [first.id])
  a.toggle(second.id)
  assert.equal(a.persist(), true)
  const newer = disk.saved.get(v2Key)
  assert.equal(b.persist(), false, 'failed clear must not overwrite a newer durable revision')
  assert.equal(disk.saved.get(v2Key), newer)
  assert.deepEqual(b.reloadSaved()?.completedLineIds, [first.id, second.id])
  b.clear()
  assert.equal(b.persist(), true)
  assert.deepEqual(done(disk.saved.get(v2Key)), [])
  assert.equal(disk.writes.length, 3)
})

test('full M2 week: temporarily unreadable clear does not advance durable revision', () => {
  const week = fullWeek()
  const [first] = week.lines.filter((line) => line.status === 'matched')
  const disk = port()
  const a = openShoppingProgressStorageV2(week, disk)
  a.toggle(first.id)
  assert.equal(a.persist(), true)
  const b = openShoppingProgressStorageV2(week, disk)
  b.clear()
  disk.denyReads(true)
  assert.equal(b.persist(), false)
  assert.deepEqual(done(disk.saved.get(v2Key)), [first.id])
  disk.denyReads(false)
  // No other tab writes occurred: retry can save the same explicit reset.
  assert.equal(b.persist(), true)
  assert.deepEqual(done(disk.saved.get(v2Key)), [])
  assert.equal(disk.writes.length, 2)
})

test('full M2 week: failed clear never advances last-known revision despite a later write', () => {
  const week = fullWeek()
  const [first, second] = week.lines.filter((line) => line.status === 'matched')
  const disk = port()
  const tabA = openShoppingProgressStorageV2(week, disk)
  const tabB = openShoppingProgressStorageV2(week, disk)
  tabA.toggle(first.id)
  assert.equal(tabA.persist(), true)
  tabB.clear()
  disk.denyWrites(true)
  assert.equal(tabB.persist(), false)
  disk.denyWrites(false)
  tabA.toggle(second.id)
  assert.equal(tabA.persist(), true)
  const pinned = disk.saved.get(v2Key)
  assert.equal(tabB.persist(), false)
  assert.equal(disk.saved.get(v2Key), pinned)
  assert.deepEqual(tabB.reloadSaved()?.completedLineIds, [first.id, second.id])
  assert.equal(disk.writes.length, 2)
})
