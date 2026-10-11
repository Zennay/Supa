import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as v2Key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { shoppingListProgressStorageKey as v1Key } from '../src/features/shopping-list/shoppingListProgress.ts'

const basket = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: ['Di'],
})
const lineIds = basket.lines.filter((line) => line.status === 'matched').map((line) => line.id)
assert.ok(lineIds.length >= 2)

function storage(initial = []) {
  const values = new Map(initial)
  let denied = true
  let writes = 0
  let reads = 0
  return {
    values,
    grant() { denied = false },
    get reads() { return reads },
    get writes() { return writes },
    getItem(key) {
      reads++
      if (denied) throw new Error('synthetic read denied')
      return values.get(key) ?? null
    },
    setItem(key, value) {
      writes++
      values.set(key, value)
    },
  }
}

test('unavailable storage status inspection never performs hidden reads or writes', () => {
  const disk = storage()
  const controller = openShoppingProgressStorageV2(basket, disk)
  assert.equal(controller.storageFormatStatus(), 'unavailable')
  const before = disk.reads
  assert.equal(controller.canRetryStorageRead(), true)
  assert.equal(controller.canRetryStorageRead(), true)
  assert.equal(disk.reads, before, 'present-port introspection is pure')
  assert.equal(disk.writes, 0)
})

test('recovering from initial read denial must never auto-upgrade legacy v1 despite opt-in', () => {
  const legacy = 'synthetic legacy bytes not owned by this session'
  const disk = storage([[v1Key, legacy]])
  const controller = openShoppingProgressStorageV2(
    basket, disk, { allowLegacyUpgrade: true },
  )
  controller.toggle(lineIds[0])
  disk.grant()
  const readsBefore = disk.reads
  const loaded = controller.reloadSaved({ requireSameDemand: true })
  assert.ok(loaded)
  assert.deepEqual(loaded.completedLineIds, [], 'absence of v2 is not consent to import v1 on retry')
  assert.equal(loaded.upgradedFromLegacy, false)
  assert.equal(disk.reads, readsBefore + 1, 'read-only retry consults only v2')
  assert.equal(disk.values.get(v1Key), legacy)
  assert.equal(disk.values.has(v2Key), false)
  assert.equal(disk.writes, 0)
})

test('future-version record appearing after denied initial read remains byte-identical on retry and save', () => {
  const future = JSON.stringify({ schemaVersion: 4, futureChecklist: ['synthetic'] })
  const disk = storage([[v2Key, future]])
  const controller = openShoppingProgressStorageV2(basket, disk)
  controller.toggle(lineIds[0])
  disk.grant()
  assert.equal(controller.reloadSaved({ requireSameDemand: true }), null)
  assert.deepEqual(controller.snapshot().completedLineIds, [lineIds[0]])
  assert.equal(controller.persist(), false)
  assert.equal(disk.values.get(v2Key), future)
  assert.equal(disk.writes, 0)
})

test('foreign saved task denial can later recover only after explicit same-demand repair; stale next tab is rejected', () => {
  const valid = serializeShoppingProgressV2(basket, [lineIds[0]])
  assert.ok(valid)
  const foreign = JSON.stringify({
    ...JSON.parse(valid),
    demandIdentity: 'synthetic:foreign-physical-checklist',
  })
  const disk = storage([[v2Key, foreign]])
  const controller = openShoppingProgressStorageV2(basket, disk)
  controller.toggle(lineIds[1])
  disk.grant()
  assert.equal(controller.reloadSaved({ requireSameDemand: true }), null)
  assert.deepEqual(controller.snapshot().completedLineIds, [lineIds[1]])
  assert.equal(disk.values.get(v2Key), foreign)
  disk.values.set(v2Key, valid) // deliberate action by another compatible client
  assert.deepEqual(
    controller.reloadSaved({ requireSameDemand: true })?.completedLineIds,
    [lineIds[0]],
  )
  assert.equal(disk.writes, 0, 'recheck itself may not persist')
  controller.toggle(lineIds[1])
  assert.equal(controller.persist(), true)
  assert.deepEqual(
    JSON.parse(disk.values.get(v2Key)).doneLineIds.sort(),
    [lineIds[0], lineIds[1]].sort(),
  )
  assert.equal(disk.writes, 1, 'only the subsequent explicit toggle is saved')

  const otherRevision = serializeShoppingProgressV2(basket, [])
  assert.ok(otherRevision)
  disk.values.set(v2Key, otherRevision)
  controller.toggle(lineIds[0])
  assert.equal(controller.persist(), false, 'external intervening change fails closed')
  assert.equal(disk.values.get(v2Key), otherRevision)
  assert.equal(disk.writes, 1)
})
