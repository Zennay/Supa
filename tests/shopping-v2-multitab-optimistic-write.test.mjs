import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'

function fixture() {
  return buildOneStoreBasket({
    store: m2Store,
    products: m2Products,
    plan: m2InitialPlan,
    activeDays: ['Di'],
    recipes: m2Recipes,
  })
}

function sharedStorage() {
  const entries = new Map()
  let failWrites = false
  return {
    entries,
    port: {
      getItem: (key) => entries.get(key) ?? null,
      setItem(key, value) {
        if (failWrites) throw new Error('synthetic quota')
        entries.set(key, value)
      },
    },
    failNextWrites(value) { failWrites = value },
  }
}

test('independent tab must not overwrite a later saved checklist from another tab', () => {
  const basket = fixture()
  const [one, two] = basket.lines.filter((line) => line.status === 'matched')
  assert.ok(one && two, 'fixture must contain two different resolved items')
  const storage = sharedStorage()
  const firstTab = openShoppingProgressStorageV2(basket, storage.port)
  const staleTab = openShoppingProgressStorageV2(basket, storage.port)
  assert.deepEqual(firstTab.snapshot().completedLineIds, [])
  assert.deepEqual(staleTab.snapshot().completedLineIds, [])

  firstTab.toggle(one.id)
  assert.equal(firstTab.persist(), true)
  const saved = storage.entries.get(shoppingListProgressV2StorageKey)
  assert.ok(saved)

  staleTab.toggle(two.id)
  assert.equal(staleTab.persist(), false, 'stale tab must fail closed instead of losing first tab checks')
  assert.equal(storage.entries.get(shoppingListProgressV2StorageKey), saved)
  assert.deepEqual(
    openShoppingProgressStorageV2(basket, storage.port).snapshot().completedLineIds,
    [one.id],
  )
})

test('tab that is older than an external clear must not resurrect old checkmarks', () => {
  const basket = fixture()
  const picked = basket.lines.find((line) => line.status === 'matched')
  assert.ok(picked)
  const storage = sharedStorage()
  const initial = openShoppingProgressStorageV2(basket, storage.port)
  initial.toggle(picked.id)
  assert.equal(initial.persist(), true)

  const olderTab = openShoppingProgressStorageV2(basket, storage.port)
  const newerTab = openShoppingProgressStorageV2(basket, storage.port)
  newerTab.clear()
  assert.equal(newerTab.persist(), true)
  const clearSnapshot = storage.entries.get(shoppingListProgressV2StorageKey)

  olderTab.toggle(picked.id)
  olderTab.toggle(picked.id)
  assert.deepEqual(olderTab.snapshot().completedLineIds, [picked.id])
  assert.equal(olderTab.persist(), false, 'old session must not resurrect checks after another tab clears')
  assert.equal(storage.entries.get(shoppingListProgressV2StorageKey), clearSnapshot)
  assert.deepEqual(
    openShoppingProgressStorageV2(basket, storage.port).snapshot().completedLineIds,
    [],
  )
})

test('the writing tab can save multiple deliberate changes without reopening', () => {
  const basket = fixture()
  const [one, two] = basket.lines.filter((line) => line.status === 'matched')
  assert.ok(one && two)
  const storage = sharedStorage()
  const tab = openShoppingProgressStorageV2(basket, storage.port)
  tab.toggle(one.id)
  assert.equal(tab.persist(), true)
  tab.toggle(two.id)
  assert.equal(tab.persist(), true)
  assert.deepEqual(
    openShoppingProgressStorageV2(basket, storage.port).snapshot().completedLineIds,
    [one.id, two.id],
  )
})

test('quota failure does not falsely advance the version: same tab can explicitly retry', () => {
  const basket = fixture()
  const line = basket.lines.find((item) => item.status === 'matched')
  assert.ok(line)
  const storage = sharedStorage()
  const tab = openShoppingProgressStorageV2(basket, storage.port)
  tab.toggle(line.id)
  storage.failNextWrites(true)
  assert.equal(tab.persist(), false)
  assert.equal(storage.entries.has(shoppingListProgressV2StorageKey), false)

  storage.failNextWrites(false)
  assert.equal(tab.persist(), true)
  assert.deepEqual(
    openShoppingProgressStorageV2(basket, storage.port).snapshot().completedLineIds,
    [line.id],
  )
})
