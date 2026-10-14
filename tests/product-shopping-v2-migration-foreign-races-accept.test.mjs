import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingListProgress,
  shoppingListProgressStorageKey as v1Key,
} from '../src/features/shopping-list/shoppingListProgress.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as v2Key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Add-only product-core acceptance on immutable DRAFT #1686.
// Fixtures are fictional; this does not establish atomic localStorage writes.
const input = { store: m2Store, products: m2Products, recipes: m2Recipes, plan: m2InitialPlan }
const current = buildOneStoreBasket({ ...input, activeDays: ['Di'] })
const foreign = buildOneStoreBasket({ ...input, activeDays: ['Di', 'Wo'] })
const currentId = current.lines.find((line) => line.status === 'matched')?.id
const foreignId = foreign.lines.find((line) => line.status === 'matched')?.id
assert.ok(currentId && foreignId)
const legacy = serializeShoppingListProgress(current, [currentId])
const foreignRaw = serializeShoppingProgressV2(foreign, [foreignId])
const sameRaw = serializeShoppingProgressV2(current, [])
assert.ok(legacy && foreignRaw && sameRaw)

function port() {
  const values = new Map([[v1Key, legacy]])
  const reads = []
  const writes = []
  return {
    values, reads, writes,
    getItem(key) {
      reads.push(key)
      return values.get(key) ?? null
    },
    setItem(key, value) {
      writes.push([key, value])
      values.set(key, value)
    },
  }
}

test('Product #1056/#1580: opt-in consent race with a foreign physical basket never rolls it back', () => {
  const disk = port()
  const controller = openShoppingProgressStorageV2(current, disk, {
    get allowLegacyUpgrade() {
      disk.values.set(v2Key, foreignRaw)
      return true
    },
  })
  assert.deepEqual(disk.reads, [v2Key, v1Key])
  assert.equal(controller.snapshot().upgradedFromLegacy, true)
  assert.deepEqual(controller.snapshot().completedLineIds, [currentId])
  assert.equal(controller.persist(), false, 'a foreign concurrent v2 must beat local migrated v1')
  assert.equal(controller.reloadSaved(), null, 'failed save may not adopt a foreign task')
  controller.clear()
  assert.equal(controller.persist(), false)
  assert.equal(disk.values.get(v2Key), foreignRaw)
  assert.equal(disk.values.get(v1Key), legacy)
  assert.deepEqual(disk.writes, [])
  assert.deepEqual(
    openShoppingProgressStorageV2(foreign, disk).snapshot().completedLineIds,
    [foreignId],
  )
})

test('Product #1056: foreign v2 created during legacy getItem also survives clear and reload', () => {
  const disk = port()
  const read = disk.getItem.bind(disk)
  disk.getItem = (key) => {
    const result = read(key)
    if (key === v1Key) disk.values.set(v2Key, foreignRaw)
    return result
  }
  const controller = openShoppingProgressStorageV2(current, disk, { allowLegacyUpgrade: true })
  assert.equal(controller.snapshot().upgradedFromLegacy, true)
  controller.toggle(currentId)
  assert.equal(controller.persist(), false)
  assert.equal(controller.reloadSaved(), null)
  controller.clear()
  assert.equal(controller.persist(), false)
  assert.equal(disk.values.get(v2Key), foreignRaw)
  assert.deepEqual(disk.writes, [])
})

test('Product #1603: denial with a side-effectful consent getter never erases an unknown v2', () => {
  const disk = port()
  const future = '{"schemaVersion":3,"opaque":{"owner":"new-client"}}'
  const controller = openShoppingProgressStorageV2(current, disk, {
    get allowLegacyUpgrade() {
      disk.values.set(v2Key, future)
      return false
    },
  })
  assert.deepEqual(disk.reads, [v2Key], 'denial must not read legacy state')
  assert.equal(controller.snapshot().upgradedFromLegacy, false)
  controller.toggle(currentId)
  assert.equal(controller.persist(), false)
  assert.equal(controller.reloadSaved(), null)
  assert.equal(disk.values.get(v2Key), future)
  assert.equal(disk.values.get(v1Key), legacy)
  assert.deepEqual(disk.writes, [])
})

test('Product #1056: throwing v1 read after remote same-demand save needs explicit read-only recovery', () => {
  const disk = port()
  const read = disk.getItem.bind(disk)
  disk.getItem = (key) => {
    if (key === v1Key) {
      disk.reads.push(key)
      disk.values.set(v2Key, sameRaw)
      throw new Error('legacy data denied after another tab saved')
    }
    return read(key)
  }
  const controller = openShoppingProgressStorageV2(current, disk, { allowLegacyUpgrade: true })
  assert.equal(controller.storageFormatStatus(), 'unavailable')
  assert.equal(controller.persist(), false)
  assert.deepEqual(disk.writes, [])
  assert.deepEqual(controller.reloadSaved()?.completedLineIds, [])
  assert.equal(controller.storageFormatStatus(), 'ready')
  assert.deepEqual(disk.reads, [v2Key, v1Key, v2Key])
  controller.toggle(currentId)
  assert.equal(controller.persist(), true)
  assert.deepEqual(disk.writes.map(([key]) => key), [v2Key])
  assert.equal(disk.values.get(v1Key), legacy)
})
