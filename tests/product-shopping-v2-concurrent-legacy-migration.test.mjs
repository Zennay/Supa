import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import {
  serializeShoppingListProgress,
  shoppingListProgressStorageKey,
} from '../src/features/shopping-list/shoppingListProgress.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'

function basketFixture() {
  return buildOneStoreBasket({
    store: m2Store, products: m2Products, plan: m2InitialPlan,
    activeDays: ['Di'], recipes: m2Recipes,
  })
}

function memoryStorage(legacy) {
  const values = new Map([[shoppingListProgressStorageKey, legacy]])
  const reads = []
  const writes = []
  return {
    values, reads, writes,
    getItem(key) {
      reads.push(key)
      return values.get(key) ?? null
    },
    setItem(key, value) {
      writes.push(key)
      values.set(key, value)
    },
  }
}

test('two simultaneous explicit v1 upgrades never overwrite the first persisted v2 snapshot', () => {
  const basket = basketFixture()
  const [first, second] = basket.lines.filter((line) => line.status === 'matched')
  assert.ok(first && second)
  const oldSnapshot = serializeShoppingListProgress(basket, [first.id])
  const disk = memoryStorage(oldSnapshot)
  const tabA = openShoppingProgressStorageV2(basket, disk, { allowLegacyUpgrade: true })
  const tabB = openShoppingProgressStorageV2(basket, disk, { allowLegacyUpgrade: true })
  assert.deepEqual(tabA.snapshot().completedLineIds, [first.id])
  assert.deepEqual(tabB.snapshot().completedLineIds, [first.id])
  assert.equal(tabA.snapshot().upgradedFromLegacy, true)
  assert.equal(tabB.snapshot().upgradedFromLegacy, true)
  assert.deepEqual(disk.writes, [], 'opening both tabs must not auto-migrate')

  assert.equal(tabA.persist(), true)
  const firstV2 = disk.values.get(shoppingListProgressV2StorageKey)
  assert.ok(firstV2)
  tabB.toggle(second.id)
  assert.equal(tabB.persist(), false, 'late legacy upgrade must not replace a newer v2 value')
  assert.equal(disk.values.get(shoppingListProgressV2StorageKey), firstV2)
  assert.equal(disk.values.get(shoppingListProgressStorageKey), oldSnapshot)
  assert.deepEqual(disk.writes, [shoppingListProgressV2StorageKey])
  assert.deepEqual(openShoppingProgressStorageV2(basket, disk).snapshot().completedLineIds, [first.id])
})

test('a fresh v2 tab takes precedence over stale legacy even with upgrade opt-in', () => {
  const basket = basketFixture()
  const [first, second] = basket.lines.filter((line) => line.status === 'matched')
  assert.ok(first && second)
  const disk = memoryStorage(serializeShoppingListProgress(basket, [first.id]))
  const upgraded = openShoppingProgressStorageV2(basket, disk, { allowLegacyUpgrade: true })
  assert.equal(upgraded.persist(), true)

  disk.reads.length = 0
  const fresh = openShoppingProgressStorageV2(basket, disk, { allowLegacyUpgrade: true })
  assert.deepEqual(disk.reads, [shoppingListProgressV2StorageKey],
    'a present v2 snapshot must suppress legacy reads')
  assert.equal(fresh.snapshot().upgradedFromLegacy, false)
  assert.deepEqual(fresh.snapshot().completedLineIds, [first.id])
  fresh.toggle(second.id)
  assert.equal(fresh.persist(), true)
  assert.deepEqual(openShoppingProgressStorageV2(basket, disk).snapshot().completedLineIds,
    [first.id, second.id])
})

test('migration based on an older v1 snapshot must respect external v2 clear', () => {
  const basket = basketFixture()
  const [first, second] = basket.lines.filter((line) => line.status === 'matched')
  assert.ok(first && second)
  const disk = memoryStorage(serializeShoppingListProgress(basket, [first.id]))
  const oldTab = openShoppingProgressStorageV2(basket, disk, { allowLegacyUpgrade: true })
  const clearTab = openShoppingProgressStorageV2(basket, disk)
  clearTab.clear()
  assert.equal(clearTab.persist(), true)
  const cleared = disk.values.get(shoppingListProgressV2StorageKey)
  oldTab.toggle(second.id)
  assert.equal(oldTab.persist(), false)
  assert.equal(disk.values.get(shoppingListProgressV2StorageKey), cleared)
  assert.deepEqual(openShoppingProgressStorageV2(basket, disk).snapshot().completedLineIds, [])
})

test('denied legacy lookup does not migrate partial data or permit later writes', () => {
  const basket = basketFixture()
  const first = basket.lines.find((line) => line.status === 'matched')
  assert.ok(first)
  const rawV1 = serializeShoppingListProgress(basket, [first.id])
  const values = new Map([[shoppingListProgressStorageKey, rawV1]])
  let attempts = 0
  let writes = 0
  const storage = {
    getItem(key) {
      attempts++
      if (key === shoppingListProgressStorageKey) throw new Error('synthetic legacy read denied')
      return values.get(key) ?? null
    },
    setItem() { writes++ },
  }
  const tab = openShoppingProgressStorageV2(basket, storage, { allowLegacyUpgrade: true })
  assert.equal(attempts, 2)
  assert.equal(tab.snapshot().upgradedFromLegacy, false)
  assert.deepEqual(tab.snapshot().completedLineIds, [])
  tab.toggle(first.id)
  assert.equal(tab.persist(), false)
  assert.equal(writes, 0)
})
