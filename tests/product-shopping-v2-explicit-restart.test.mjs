import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { shoppingListProgressStorageKey } from '../src/features/shopping-list/shoppingListProgress.ts'

const basket = (products = m2Products, store = m2Store) => buildOneStoreBasket({
  store,
  products,
  activeDays: ['Di'],
  plan: m2InitialPlan,
  recipes: m2Recipes,
})

function fakeStorage() {
  const data = new Map()
  const writes = []
  return {
    data,
    writes,
    getItem(key) { return data.get(key) ?? null },
    setItem(key, value) { writes.push([key, value]); data.set(key, value) },
  }
}

test('an explicit restart empties and persists only current physical-v2 checks', () => {
  const first = basket()
  const checked = first.lines.find((line) => line.status === 'matched')
  assert.ok(checked)
  const storage = fakeStorage()
  storage.data.set(shoppingListProgressStorageKey, '{"schemaVersion":1,"legacy":"keep"}')
  const controller = openShoppingProgressStorageV2(first, storage)
  assert.deepEqual(controller.snapshot().completedLineIds, [])
  assert.deepEqual(controller.toggle(checked.id).completedLineIds, [checked.id])
  assert.equal(controller.persist(), true)
  assert.deepEqual(controller.clear().completedLineIds, [])
  assert.equal(controller.snapshot().upgradedFromLegacy, false)
  assert.equal(controller.persist(), true)

  const persisted = JSON.parse(storage.data.get(shoppingListProgressV2StorageKey))
  assert.equal(persisted.schemaVersion, 2)
  assert.deepEqual(persisted.doneLineIds, [])
  assert.equal(storage.data.get(shoppingListProgressStorageKey), '{"schemaVersion":1,"legacy":"keep"}')
  assert.equal(storage.writes.length, 2)
  assert.ok(storage.writes.every(([key]) => key === shoppingListProgressV2StorageKey))
  assert.deepEqual(
    openShoppingProgressStorageV2(first, storage).snapshot().completedLineIds,
    [],
    'reload must not restore a previously checked task after explicit restart',
  )
})

test('price refresh preserves a check until explicit restart, then cannot resurrect it', () => {
  const first = basket()
  const picked = first.lines.find((row) => row.status === 'matched')
  assert.ok(picked)
  const updated = basket(m2Products.map((product) => ({
    ...product,
    priceCents: product.priceCents + 9,
  })))
  assert.notEqual(first.totalCents, updated.totalCents)
  const storage = fakeStorage()
  const controller = openShoppingProgressStorageV2(first, storage)
  controller.toggle(picked.id)
  assert.deepEqual(controller.rebase(updated).completedLineIds, [picked.id])
  assert.deepEqual(controller.clear().completedLineIds, [])
  assert.equal(controller.persist(), true)
  assert.deepEqual(controller.rebase(first).completedLineIds, [])
  assert.deepEqual(
    openShoppingProgressStorageV2(updated, storage).snapshot().completedLineIds,
    [],
  )
})

test('invalid baskets and denied persistence never save a fabricated restart', () => {
  const initial = basket()
  const storage = fakeStorage()
  const controller = openShoppingProgressStorageV2(initial, storage)
  controller.toggle(initial.lines[0].id)
  controller.rebase({ ...initial, lines: [null] })
  const invalid = controller.clear()
  assert.equal(invalid.demandIdentity, null)
  assert.equal(invalid.serialized, null)
  assert.deepEqual(invalid.completedLineIds, [])
  assert.equal(controller.persist(), false)
  assert.deepEqual(storage.writes, [])

  const blocked = openShoppingProgressStorageV2(initial, {
    getItem() { throw new Error('synthetic private browser') },
    setItem() { throw new Error('synthetic private browser') },
  })
  blocked.toggle(initial.lines[0].id)
  assert.deepEqual(blocked.clear().completedLineIds, [])
  assert.equal(blocked.persist(), false)
})
