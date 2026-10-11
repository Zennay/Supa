import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'

const makeBasket = () => buildOneStoreBasket({
  store: m2Store,
  products: m2Products,
  plan: m2InitialPlan,
  activeDays: ['Di'],
  recipes: m2Recipes,
})

test('failed storage write during explicit reset is reported, never treated as successful persistence, and is retryable', () => {
  const original = makeBasket()
  const row = original.lines.find((line) => line.status === 'matched')
  assert.ok(row)
  let denyWrites = false
  const values = new Map()
  const successfulWrites = []
  const port = {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) {
      if (denyWrites) throw new Error('synthetic storage quota')
      successfulWrites.push([key, value])
      values.set(key, value)
    },
  }
  const controller = openShoppingProgressStorageV2(original, port)
  controller.toggle(row.id)
  assert.equal(controller.persist(), true)
  const saved = values.get(shoppingListProgressV2StorageKey)

  denyWrites = true
  const cleared = controller.clear()
  assert.deepEqual(cleared.completedLineIds, [])
  assert.deepEqual(controller.snapshot().completedLineIds, [])
  assert.equal(controller.persist(), false, 'caller must surface a save-failure warning')
  assert.equal(values.get(shoppingListProgressV2StorageKey), saved)
  assert.equal(successfulWrites.length, 1)

  denyWrites = false
  assert.equal(controller.persist(), true, 'an explicit retry may commit the same cleared session')
  assert.deepEqual(JSON.parse(values.get(shoppingListProgressV2StorageKey)).doneLineIds, [])
  assert.deepEqual(
    openShoppingProgressStorageV2(original, port).snapshot().completedLineIds,
    [],
    'a successful follow-up save is durable across controller reconstruction',
  )
  assert.equal(successfulWrites.length, 2)
  assert.ok(successfulWrites.every(([key]) => key === shoppingListProgressV2StorageKey))
})

test('invalidated basket cannot overwrite previously persisted checks with a false reset snapshot', () => {
  const original = makeBasket()
  const row = original.lines.find((line) => line.status === 'matched')
  assert.ok(row)
  const values = new Map()
  const writes = []
  const port = {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value); writes.push([key, value]) },
  }
  const controller = openShoppingProgressStorageV2(original, port)
  controller.toggle(row.id)
  assert.equal(controller.persist(), true)
  const saved = values.get(shoppingListProgressV2StorageKey)

  const invalid = { ...original, lines: [null] }
  const rebased = controller.rebase(invalid)
  assert.equal(rebased.demandIdentity, null)
  const cleared = controller.clear()
  assert.equal(cleared.serialized, null)
  assert.deepEqual(cleared.completedLineIds, [])
  assert.equal(controller.persist(), false)
  assert.equal(writes.length, 1)
  assert.equal(values.get(shoppingListProgressV2StorageKey), saved)

  // Restoring a still valid original basket reads only the original trusted record.
  assert.deepEqual(
    openShoppingProgressStorageV2(original, port).snapshot().completedLineIds,
    [row.id],
  )
})

test('if the initial v2 storage read throws, a later clear cannot silently become durable', () => {
  const basket = makeBasket()
  let writes = 0
  const port = {
    getItem() { throw new Error('synthetic private browsing read rejection') },
    setItem() { writes += 1 },
  }
  const controller = openShoppingProgressStorageV2(basket, port)
  const row = basket.lines.find((line) => line.status === 'matched')
  assert.ok(row)
  assert.deepEqual(controller.toggle(row.id).completedLineIds, [row.id])
  assert.deepEqual(controller.clear().completedLineIds, [])
  assert.equal(controller.persist(), false)
  assert.equal(writes, 0)
})
