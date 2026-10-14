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
    activeDays: ['Di'],
    plan: m2InitialPlan,
    recipes: m2Recipes,
  })
}

function fakeStorage() {
  const values = new Map()
  const writes = []
  return {
    values,
    writes,
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { writes.push([key, value]); values.set(key, value) },
  }
}

test('QA shopping v2: physical pack mutation between toggle and persist cannot write stale identity', () => {
  const current = basket()
  const matched = current.lines.find((row) => row.status === 'matched')
  assert.ok(matched)
  const disk = fakeStorage()
  const controller = openShoppingProgressStorageV2(current, disk)
  assert.deepEqual(controller.toggle(matched.id).completedLineIds, [matched.id])

  // The original object is mutated after the last toggle: no rebase event.
  matched.pack.count += 1
  assert.equal(controller.persist(), false, 'must fail closed instead of writing the old task identity')
  assert.deepEqual(disk.writes, [])
  assert.equal(disk.values.has(shoppingListProgressV2StorageKey), false)
})

test('QA shopping v2: invalidated store object before persist cannot overwrite storage', () => {
  const current = basket()
  const disk = fakeStorage()
  const controller = openShoppingProgressStorageV2(current, disk)
  controller.toggle(current.lines[0].id)

  current.store = null
  assert.equal(controller.persist(), false)
  assert.deepEqual(disk.writes, [])
})

test('QA shopping v2: price-only mutation after toggle remains persistable', () => {
  const current = basket()
  const checked = current.lines.find((row) => row.status === 'matched')
  assert.ok(checked)
  const disk = fakeStorage()
  const controller = openShoppingProgressStorageV2(current, disk)
  controller.toggle(checked.id)

  current.totalCents += 1 // money-only metadata, no physical task change
  assert.equal(controller.persist(), true)
  assert.deepEqual(disk.writes.map(([key]) => key), [shoppingListProgressV2StorageKey])
  assert.deepEqual(openShoppingProgressStorageV2(current, disk).snapshot().completedLineIds, [checked.id])
})
