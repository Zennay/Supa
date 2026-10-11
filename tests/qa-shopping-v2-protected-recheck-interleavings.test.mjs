import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Independent review-only QA on frozen #1623; this fake port is not a
// browser CAS or real participant/retailer evidence.
const localBasket = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: ['Di'],
})
const lineIds = localBasket.lines.filter((line) => line.status === 'matched').map((line) => line.id)
assert.ok(lineIds.length >= 2)
const [first, second] = lineIds
const foreignBasket = structuredClone(localBasket)
foreignBasket.store.id = 'synthetic-other-store'
const foreign = serializeShoppingProgressV2(foreignBasket, [first])
const local = serializeShoppingProgressV2(localBasket, [second])
assert.ok(foreign && local)

function fakeDisk(initial) {
  const data = new Map()
  if (initial !== null) data.set(key, initial)
  let writes = 0
  let denyRead = false
  return {
    data,
    get writes() { return writes },
    set denyRead(value) { denyRead = value },
    getItem(name) {
      if (denyRead) throw new Error('synthetic storage denial')
      return data.get(name) ?? null
    },
    setItem(name, value) { writes++; data.set(name, value) },
  }
}

test('QA strict recheck: rejected foreign record can recover after legitimate same-demand replacement only', () => {
  const rawFuture = '{"schemaVersion":99,"opaque":"synthetic"}'
  const disk = fakeDisk(rawFuture)
  const c = openShoppingProgressStorageV2(localBasket, disk)
  c.toggle(first)
  assert.equal(c.storageFormatStatus(), 'unknown-record')
  disk.data.set(key, foreign)
  assert.equal(c.reloadSaved({ requireSameDemand: true }), null)
  assert.deepEqual(c.snapshot().completedLineIds, [first], 'failed read keeps temporary tick')
  assert.equal(disk.data.get(key), foreign)

  disk.data.set(key, local)
  assert.deepEqual(c.reloadSaved({ requireSameDemand: true })?.completedLineIds, [second])
  assert.equal(c.storageFormatStatus(), 'ready')
  assert.equal(disk.writes, 0, 'strict recheck itself never writes')

  // Another tab switches to the foreign basket again: the recovered tab must
  // refuse a stale write despite its earlier successful same-demand recheck.
  disk.data.set(key, foreign)
  c.toggle(first)
  assert.equal(c.persist(), false)
  assert.equal(disk.data.get(key), foreign)
  assert.equal(disk.writes, 0)
})

test('QA strict recheck: a legitimately deleted unknown record reloads read-only and can save a new user tick', () => {
  const rawUnknown = '{"schemaVersion":3,"opaque":"synthetic"}'
  const disk = fakeDisk(rawUnknown)
  const c = openShoppingProgressStorageV2(localBasket, disk)
  assert.equal(c.storageFormatStatus(), 'unknown-record')
  disk.data.delete(key)
  assert.deepEqual(c.reloadSaved({ requireSameDemand: true })?.completedLineIds, [])
  assert.equal(c.storageFormatStatus(), 'ready')
  assert.equal(disk.writes, 0)
  c.toggle(first)
  assert.equal(c.persist(), true, 'a deliberate user action may persist after valid read-only recovery')
  assert.equal(disk.writes, 1)
  assert.deepEqual(JSON.parse(disk.data.get(key)).doneLineIds, [first])
})

test('QA strict recheck: denied storage read preserves protected status and local ticks until explicit retry', () => {
  const disk = fakeDisk('{"schemaVersion":8}')
  const c = openShoppingProgressStorageV2(localBasket, disk)
  c.toggle(first)
  disk.data.set(key, local)
  disk.denyRead = true
  assert.equal(c.reloadSaved({ requireSameDemand: true }), null)
  assert.equal(c.storageFormatStatus(), 'unknown-record')
  assert.deepEqual(c.snapshot().completedLineIds, [first])
  assert.equal(disk.writes, 0)
  disk.denyRead = false
  assert.deepEqual(c.reloadSaved({ requireSameDemand: true })?.completedLineIds, [second])
  assert.equal(c.storageFormatStatus(), 'ready')
  assert.equal(disk.writes, 0)
})
