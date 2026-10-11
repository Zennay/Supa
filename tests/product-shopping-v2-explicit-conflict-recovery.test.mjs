import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'
import {
  serializeShoppingListProgress,
  shoppingListProgressStorageKey,
} from '../src/features/shopping-list/shoppingListProgress.ts'

function basket() {
  return buildOneStoreBasket({
    store: m2Store,
    products: m2Products,
    plan: m2InitialPlan,
    activeDays: ['Di'],
    recipes: m2Recipes,
  })
}

function sharedStorage() {
  const values = new Map()
  const writes = []
  const reads = []
  let denyRead = false
  return {
    values, writes, reads,
    denyRead(value) { denyRead = value },
    port: {
      getItem(key) {
        reads.push(key)
        if (denyRead) throw new Error('synthetic private-mode denial')
        return values.get(key) ?? null
      },
      setItem(key, value) {
        writes.push([key, value])
        values.set(key, value)
      },
    },
  }
}

test('stale tab may explicitly reload the newer saved list and then add another check', () => {
  const current = basket()
  const [first, second] = current.lines.filter((line) => line.status === 'matched')
  assert.ok(first && second)
  const disk = sharedStorage()
  const tabA = openShoppingProgressStorageV2(current, disk.port)
  const tabB = openShoppingProgressStorageV2(current, disk.port)
  tabA.toggle(first.id)
  assert.equal(tabA.persist(), true)
  tabB.toggle(second.id)
  assert.equal(tabB.persist(), false)
  const before = disk.writes.length

  const recovered = tabB.reloadSaved()
  assert.ok(recovered, 'explicit recovery returns a validated new session')
  assert.deepEqual(recovered.completedLineIds, [first.id])
  assert.deepEqual(tabB.snapshot().completedLineIds, [first.id])
  assert.equal(disk.writes.length, before, 'refresh is read-only')
  tabB.toggle(second.id)
  assert.equal(tabB.persist(), true)
  assert.deepEqual(
    openShoppingProgressStorageV2(current, disk.port).snapshot().completedLineIds,
    [first.id, second.id],
  )
  assert.equal(tabA.persist(), false, 'older tab must not overwrite recovered tab')
})

test('after an external clear, explicit refresh discards stale draft without resurrection', () => {
  const current = basket()
  const [first, second] = current.lines.filter((line) => line.status === 'matched')
  assert.ok(first && second)
  const disk = sharedStorage()
  const writer = openShoppingProgressStorageV2(current, disk.port)
  writer.toggle(first.id)
  assert.equal(writer.persist(), true)
  const older = openShoppingProgressStorageV2(current, disk.port)
  const clearer = openShoppingProgressStorageV2(current, disk.port)
  clearer.clear()
  assert.equal(clearer.persist(), true)
  const latestValue = disk.values.get(shoppingListProgressV2StorageKey)
  older.toggle(second.id)
  assert.equal(older.persist(), false)

  const recovered = older.reloadSaved()
  assert.ok(recovered)
  assert.deepEqual(recovered.completedLineIds, [])
  assert.equal(disk.values.get(shoppingListProgressV2StorageKey), latestValue)
  older.toggle(second.id)
  assert.equal(older.persist(), true)
  assert.deepEqual(openShoppingProgressStorageV2(current, disk.port).snapshot().completedLineIds, [second.id])
})

test('failed refresh never discards local checks or advances the observed storage version', () => {
  const current = basket()
  const [first, second] = current.lines.filter((line) => line.status === 'matched')
  assert.ok(first && second)
  const disk = sharedStorage()
  const old = openShoppingProgressStorageV2(current, disk.port)
  old.toggle(second.id)
  const newer = openShoppingProgressStorageV2(current, disk.port)
  newer.toggle(first.id)
  assert.equal(newer.persist(), true)

  disk.denyRead(true)
  assert.equal(old.reloadSaved(), null)
  assert.deepEqual(old.snapshot().completedLineIds, [second.id])
  disk.denyRead(false)
  assert.equal(old.persist(), false, 'a denied reload must not allow stale overwrite')
  assert.deepEqual(old.reloadSaved()?.completedLineIds, [first.id])
  assert.equal(old.persist(), true)
  assert.deepEqual(openShoppingProgressStorageV2(current, disk.port).snapshot().completedLineIds, [first.id])
})

test('explicit reload can recover from initial storage denial, never implicitly upgrade v1', () => {
  const current = basket()
  const first = current.lines.find((line) => line.status === 'matched')
  assert.ok(first)
  const disk = sharedStorage()
  disk.values.set(shoppingListProgressStorageKey, serializeShoppingListProgress(current, [first.id]))
  disk.denyRead(true)
  const tab = openShoppingProgressStorageV2(current, disk.port, { allowLegacyUpgrade: true })
  disk.denyRead(false)
  assert.equal(tab.snapshot().upgradedFromLegacy, false)
  tab.toggle(first.id)
  assert.equal(tab.persist(), false)
  const beforeReads = disk.reads.length
  const refreshed = tab.reloadSaved()
  assert.ok(refreshed)
  assert.deepEqual(refreshed.completedLineIds, [])
  assert.equal(refreshed.upgradedFromLegacy, false)
  assert.deepEqual(disk.reads.slice(beforeReads), [shoppingListProgressV2StorageKey])
  assert.deepEqual(disk.writes, [])
  tab.toggle(first.id)
  assert.equal(tab.persist(), true)
  assert.deepEqual(openShoppingProgressStorageV2(current, disk.port).snapshot().completedLineIds, [first.id])
})

test('a physically invalid basket or unavailable storage never claims successful reload', () => {
  const valid = basket()
  const chosen = valid.lines.find((line) => line.status === 'matched')
  assert.ok(chosen)
  const disk = sharedStorage()
  const tab = openShoppingProgressStorageV2(valid, disk.port)
  tab.toggle(chosen.id)
  const oldSession = tab.snapshot()
  tab.rebase({ ...valid, store: null })
  const before = disk.reads.length
  assert.equal(tab.reloadSaved(), null)
  assert.equal(disk.reads.length, before)
  assert.deepEqual(tab.snapshot().completedLineIds, [])
  const disabled = openShoppingProgressStorageV2(valid, null)
  disabled.toggle(chosen.id)
  assert.equal(disabled.reloadSaved(), null)
  assert.deepEqual(disabled.snapshot().completedLineIds, oldSession.completedLineIds)
  assert.deepEqual(disk.writes, [])
})

test('existing stale-write guard remains fail-closed while no explicit reload occurs', () => {
  const current = basket()
  const [first, second] = current.lines.filter((line) => line.status === 'matched')
  assert.ok(first && second)
  const disk = sharedStorage()
  const a = openShoppingProgressStorageV2(current, disk.port)
  const b = openShoppingProgressStorageV2(current, disk.port)
  a.toggle(first.id)
  assert.equal(a.persist(), true)
  b.toggle(second.id)
  assert.equal(b.persist(), false)
  assert.deepEqual(openShoppingProgressStorageV2(current, disk.port).snapshot().completedLineIds, [first.id])
  assert.equal(disk.writes.length, 1)
})
