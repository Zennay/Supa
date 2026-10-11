import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2, shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Independent synthetic #1603 regression, stacked on frozen #1735.
// A *canonical foreign demand identity* does not make unrelated checked IDs
// part of that foreign basket. Never turn corrupt/future-state data into v2.
const local = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: m2DefaultActiveDays,
})
assert.equal(local.lines.length, 11)
const first = local.lines.find(line => line.status === 'matched')
assert.ok(first)
const foreign = {
  ...local, store: { ...local.store, id: 'fixture-foreign-grocer' },
}
const validForeign = serializeShoppingProgressV2(foreign, [first.id])
assert.ok(validForeign)

function storage(initial) {
  const bytes = new Map([[key, initial]])
  const reads = []
  const writes = []
  return {
    bytes, reads, writes,
    getItem(name) {
      reads.push(name)
      assert.equal(name, key, 'never read legacy v1')
      return bytes.get(name) ?? null
    },
    setItem(name, value) {
      assert.equal(name, key)
      writes.push(value)
      bytes.set(name, value)
    },
  }
}

test('RED #1603: foreign canonical envelope with phantom completed ID is protected, not downgraded', () => {
  const malformed = JSON.stringify({
    ...JSON.parse(validForeign),
    doneLineIds: ['future-line-not-in-foreign-demand'],
  })
  const disk = storage(malformed)
  const tab = openShoppingProgressStorageV2(local, disk)
  assert.equal(tab.storageFormatStatus(), 'unknown-record')
  tab.toggle(first.id)
  assert.equal(tab.persist(), false)
  assert.equal(tab.reloadSaved(), null, 'manual reload must not unlock malformed bytes')
  tab.clear()
  assert.equal(tab.persist(), false)
  assert.equal(disk.bytes.get(key), malformed)
  assert.deepEqual(disk.writes, [])
  assert.ok(disk.reads.every(name => name === key))
})

test('RED #1603: mixed valid and unknown foreign doneLineIds preserve original byte sequence', () => {
  const malformed = JSON.stringify({
    ...JSON.parse(validForeign),
    doneLineIds: [first.id, 'foreign-extension-line'],
  })
  const disk = storage(malformed)
  const tab = openShoppingProgressStorageV2(local, disk)
  assert.equal(tab.storageFormatStatus(), 'unknown-record')
  tab.rebase(local)
  tab.toggle(first.id)
  assert.equal(tab.persist(), false)
  assert.equal(disk.bytes.get(key), malformed)
  assert.deepEqual(disk.writes, [])
})

test('control #1603: recognized canonical foreign task with valid checked ID can be deliberately replaced', () => {
  const disk = storage(validForeign)
  const tab = openShoppingProgressStorageV2(local, disk)
  assert.equal(tab.storageFormatStatus(), 'ready')
  tab.toggle(first.id)
  assert.equal(tab.persist(), true)
  assert.notEqual(disk.bytes.get(key), validForeign)
  assert.deepEqual(JSON.parse(disk.bytes.get(key)).doneLineIds, [first.id])
  assert.equal(disk.writes.length, 1)
})

test('control #1603: same-demand v2 record with valid checked ID still restores normally', () => {
  const supported = serializeShoppingProgressV2(local, [first.id])
  const disk = storage(supported)
  const tab = openShoppingProgressStorageV2(local, disk)
  assert.equal(tab.storageFormatStatus(), 'ready')
  assert.deepEqual(tab.snapshot().completedLineIds, [first.id])
  assert.equal(tab.persist(), true)
  assert.equal(disk.bytes.get(key), supported)
})
