import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'

function basketFixture() {
  return buildOneStoreBasket({
    store: m2Store, products: m2Products, plan: m2InitialPlan,
    activeDays: ['Di'], recipes: m2Recipes,
  })
}

function storageFixture() {
  const values = new Map()
  const writes = []
  return {
    values, writes,
    port: {
      getItem(key) { return values.get(key) ?? null },
      setItem(key, value) {
        writes.push([key, value])
        values.set(key, value)
      },
    },
  }
}

function priceOnlyBasket(basket) {
  const next = structuredClone(basket)
  const line = next.lines.find((item) => item.status === 'matched')
  assert.ok(line)
  line.pricePerPackCents += 1
  line.lineTotalCents += line.packs
  assert.equal(shoppingListDemandIdentity(next), shoppingListDemandIdentity(basket))
  return next
}

test('a stale price-refresh tab cannot restore checks cleared by another tab', () => {
  const original = basketFixture()
  const [first, second] = original.lines.filter((line) => line.status === 'matched')
  assert.ok(first && second)
  const disk = storageFixture()
  const initial = openShoppingProgressStorageV2(original, disk.port)
  initial.toggle(first.id)
  assert.equal(initial.persist(), true)

  const older = openShoppingProgressStorageV2(original, disk.port)
  const clearer = openShoppingProgressStorageV2(original, disk.port)
  clearer.clear()
  assert.equal(clearer.persist(), true)
  const durableClear = disk.values.get(shoppingListProgressV2StorageKey)
  const refreshed = priceOnlyBasket(original)
  assert.deepEqual(older.rebase(refreshed).completedLineIds, [first.id])
  older.toggle(second.id)
  assert.equal(older.persist(), false, 'financial-only change is never an override of a newer clear')
  assert.equal(disk.values.get(shoppingListProgressV2StorageKey), durableClear)
  assert.deepEqual(openShoppingProgressStorageV2(refreshed, disk.port).snapshot().completedLineIds, [])
})

test('changed physical week cannot replace another tab\'s newer checklist', () => {
  const original = basketFixture()
  const [first, second] = original.lines.filter((line) => line.status === 'matched')
  assert.ok(first && second)
  const disk = storageFixture()
  const older = openShoppingProgressStorageV2(original, disk.port)
  const newer = openShoppingProgressStorageV2(original, disk.port)
  newer.toggle(first.id)
  assert.equal(newer.persist(), true)
  const durable = disk.values.get(shoppingListProgressV2StorageKey)

  const changed = structuredClone(original)
  changed.store.id = 'synthetic-another-store'
  assert.notEqual(shoppingListDemandIdentity(changed), shoppingListDemandIdentity(original))
  assert.deepEqual(older.rebase(changed).completedLineIds, [])
  older.toggle(second.id)
  assert.equal(older.persist(), false)
  assert.equal(disk.values.get(shoppingListProgressV2StorageKey), durable)
  assert.deepEqual(openShoppingProgressStorageV2(original, disk.port).snapshot().completedLineIds, [first.id])
})

test('fresh tab may intentionally write new physical demand after reading the current value', () => {
  const original = basketFixture()
  const first = original.lines.find((line) => line.status === 'matched')
  assert.ok(first)
  const disk = storageFixture()
  const initial = openShoppingProgressStorageV2(original, disk.port)
  initial.toggle(first.id)
  assert.equal(initial.persist(), true)

  const changed = structuredClone(original)
  changed.store.id = 'synthetic-new-week-store'
  const fresh = openShoppingProgressStorageV2(changed, disk.port)
  assert.deepEqual(fresh.snapshot().completedLineIds, [])
  assert.equal(fresh.persist(), true, 'current observed value permits a deliberate new physical checklist')
  assert.deepEqual(openShoppingProgressStorageV2(changed, disk.port).snapshot().completedLineIds, [])
  assert.deepEqual(openShoppingProgressStorageV2(original, disk.port).snapshot().completedLineIds, [])
})
