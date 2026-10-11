import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'

function physicalTasks() {
  const oldBasket = buildOneStoreBasket({
    store: m2Store, products: m2Products, plan: m2InitialPlan,
    activeDays: m2InitialPlan.map((entry) => entry.day), recipes: m2Recipes,
  })
  const newBasket = structuredClone(oldBasket)
  newBasket.store.id = 'synthetic-new-physical-store'
  const [first, second] = oldBasket.lines.filter((line) => line.status === 'matched')
  assert.ok(first && second)
  return { oldBasket, newBasket, first: first.id, second: second.id }
}

function disk() {
  const values = new Map()
  let writes = 0
  return {
    values,
    get writes() { return writes },
    port: {
      getItem(key) { return values.get(key) ?? null },
      setItem(key, value) { writes++; values.set(key, value) },
    },
  }
}

test('a tab can explicitly adopt a newer physical task after blocked stale recovery', () => {
  const { oldBasket, newBasket, first, second } = physicalTasks()
  const storage = disk()
  const stale = openShoppingProgressStorageV2(oldBasket, storage.port)
  const owner = openShoppingProgressStorageV2(newBasket, storage.port)
  owner.toggle(first)
  assert.equal(owner.persist(), true)
  stale.toggle(second)
  assert.equal(stale.persist(), false)
  assert.equal(stale.reloadSaved(), null)
  assert.deepEqual(stale.snapshot().completedLineIds, [second])

  // The parent basket changed on purpose: it is now the persisted shopping task.
  stale.rebase(newBasket)
  assert.deepEqual(stale.reloadSaved()?.completedLineIds, [first])
  stale.toggle(second)
  assert.equal(stale.persist(), true)
  assert.deepEqual(
    openShoppingProgressStorageV2(newBasket, storage.port).snapshot().completedLineIds,
    [first, second],
  )
  assert.equal(storage.writes, 2)
})

test('a foreign task can advance twice without letting an older tab recover and undo either revision', () => {
  const { oldBasket, newBasket, first, second } = physicalTasks()
  const storage = disk()
  const stale = openShoppingProgressStorageV2(oldBasket, storage.port)
  const owner = openShoppingProgressStorageV2(newBasket, storage.port)
  owner.toggle(first)
  assert.equal(owner.persist(), true)
  stale.toggle(first)
  assert.equal(stale.persist(), false)

  owner.toggle(second)
  assert.equal(owner.persist(), true)
  const latest = storage.values.get(shoppingListProgressV2StorageKey)
  assert.equal(stale.reloadSaved(), null)
  assert.equal(stale.persist(), false)
  assert.equal(storage.values.get(shoppingListProgressV2StorageKey), latest)
  assert.equal(storage.writes, 2)
  assert.deepEqual(
    openShoppingProgressStorageV2(newBasket, storage.port).snapshot().completedLineIds,
    [first, second],
  )
})

test('corrupt external v2 revision after a detected conflict never authorizes a stale overwrite', () => {
  const { oldBasket, newBasket, first } = physicalTasks()
  const storage = disk()
  const stale = openShoppingProgressStorageV2(oldBasket, storage.port)
  const owner = openShoppingProgressStorageV2(newBasket, storage.port)
  owner.toggle(first)
  assert.equal(owner.persist(), true)
  stale.toggle(first)
  assert.equal(stale.persist(), false)

  const invalid = '{synthetic-invalid-json'
  storage.values.set(shoppingListProgressV2StorageKey, invalid)
  const before = stale.snapshot()
  assert.equal(stale.reloadSaved(), null)
  assert.deepEqual(stale.snapshot(), before)
  assert.equal(stale.persist(), false)
  assert.equal(storage.values.get(shoppingListProgressV2StorageKey), invalid)
  assert.equal(storage.writes, 1)
})
