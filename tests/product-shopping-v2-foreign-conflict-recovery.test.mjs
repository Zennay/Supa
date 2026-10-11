import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'

function basket() {
  return buildOneStoreBasket({
    store: m2Store,
    products: m2Products,
    plan: m2InitialPlan,
    activeDays: m2InitialPlan.map((entry) => entry.day),
    recipes: m2Recipes,
  })
}

function sharedStorage() {
  const values = new Map()
  let writeCount = 0
  return {
    values,
    get writes() { return writeCount },
    port: {
      getItem(key) { return values.get(key) ?? null },
      setItem(key, value) { writeCount += 1; values.set(key, value) },
    },
  }
}

function replacedPhysicalDemand() {
  const oldBasket = basket()
  const freshBasket = structuredClone(oldBasket)
  freshBasket.store.id = 'synthetic-replacement-store'
  return { oldBasket, freshBasket }
}

test('stale old-demand tab refuses a foreign v2 recovery instead of presenting new task as empty', () => {
  const { oldBasket, freshBasket } = replacedPhysicalDemand()
  const firstLine = oldBasket.lines.find((line) => line.status === 'matched')
  assert.ok(firstLine)
  const disk = sharedStorage()
  const stale = openShoppingProgressStorageV2(oldBasket, disk.port)
  const owner = openShoppingProgressStorageV2(freshBasket, disk.port)

  owner.toggle(firstLine.id)
  assert.equal(owner.persist(), true)
  const foreignValue = disk.values.get(shoppingListProgressV2StorageKey)
  assert.ok(foreignValue)
  stale.toggle(firstLine.id)
  assert.equal(stale.persist(), false, 'the ordinary optimistic conflict check works')

  const before = stale.snapshot()
  const writes = disk.writes
  assert.equal(stale.reloadSaved(), null, 'explicit reload must reject a newer foreign physical basket')
  assert.deepEqual(stale.snapshot(), before, 'failed recovery must preserve unsaved local checkmarks')
  assert.equal(disk.writes, writes)
  assert.equal(disk.values.get(shoppingListProgressV2StorageKey), foreignValue)
})

test('attempted stale reload cannot pin a foreign revision and roll current shopping task back', () => {
  const { oldBasket, freshBasket } = replacedPhysicalDemand()
  const firstLine = oldBasket.lines.find((line) => line.status === 'matched')
  assert.ok(firstLine)
  const disk = sharedStorage()
  const stale = openShoppingProgressStorageV2(oldBasket, disk.port)
  const owner = openShoppingProgressStorageV2(freshBasket, disk.port)
  owner.toggle(firstLine.id)
  assert.equal(owner.persist(), true)
  const foreignValue = disk.values.get(shoppingListProgressV2StorageKey)

  stale.toggle(firstLine.id)
  assert.equal(stale.persist(), false)
  stale.reloadSaved()
  assert.equal(stale.persist(), false, 'a failed recovery cannot authorize a stale write')
  assert.equal(disk.values.get(shoppingListProgressV2StorageKey), foreignValue)
  assert.deepEqual(
    openShoppingProgressStorageV2(freshBasket, disk.port).snapshot().completedLineIds,
    [firstLine.id],
  )
  assert.equal(disk.writes, 1)
})

test('fresh explicitly opened different-demand tab retains the supported deliberate task switch', () => {
  const { oldBasket, freshBasket } = replacedPhysicalDemand()
  const firstLine = oldBasket.lines.find((line) => line.status === 'matched')
  assert.ok(firstLine)
  const disk = sharedStorage()
  const previous = openShoppingProgressStorageV2(oldBasket, disk.port)
  previous.toggle(firstLine.id)
  assert.equal(previous.persist(), true)
  const next = openShoppingProgressStorageV2(freshBasket, disk.port)
  assert.deepEqual(next.snapshot().completedLineIds, [])
  assert.equal(next.persist(), true, 'a fresh controller may deliberately accept a new physical task')
  assert.equal(
    JSON.parse(disk.values.get(shoppingListProgressV2StorageKey)).doneLineIds.length,
    0,
  )
})
