import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListProgressStorageKey } from '../src/features/shopping-list/shoppingListProgress.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'

function basket() {
  return buildOneStoreBasket({
    store: { ...m2Store },
    plan: m2InitialPlan,
    recipes: m2Recipes,
    products: m2Products,
    activeDays: ['Di'],
  })
}

test('QA #1603: unsupported persistent formats are immutable even after a user checks an item', () => {
  const original = basket()
  const lineId = original.lines[0].id
  const originalSnapshot = structuredClone(original)
  const invalidRecords = [
    ['future schema', JSON.stringify({ schemaVersion: 3, demandIdentity: 'future-v3', doneLineIds: ['old'] })],
    ['corrupt JSON', '{"schemaVersion":2,"demandIdentity":'],
    ['wrong root shape', '[]'],
    ['unsupported extension', JSON.stringify({ schemaVersion: 2, demandIdentity: 'opaque', doneLineIds: [], privateFutureField: true })],
    ['duplicate root version', '{"schemaVersion":2,"schemaVersion":3,"demandIdentity":"opaque","doneLineIds":[]}'],
    ['opaque physical demand', JSON.stringify({ schemaVersion: 2, demandIdentity: '{"schemaVersion":2}', doneLineIds: [] })],
  ]

  for (const [name, originalBytes] of invalidRecords) {
    const data = new Map([
      [shoppingListProgressV2StorageKey, originalBytes],
      [shoppingListProgressStorageKey, 'legacy-v1-do-not-touch'],
    ])
    const reads = []
    const writes = []
    const port = {
      getItem(key) { reads.push(key); return data.get(key) ?? null },
      setItem(key, value) { writes.push([key, value]); data.set(key, value) },
    }
    const controller = openShoppingProgressStorageV2(original, port)
    assert.equal(controller.storageFormatStatus(), 'unknown-record', name)
    controller.toggle(lineId)
    assert.equal(controller.persist(), false, name)
    assert.equal(controller.reloadSaved({ requireSameDemand: true }), null, name)
    controller.clear()
    assert.equal(controller.persist(), false, name)
    assert.equal(data.get(shoppingListProgressV2StorageKey), originalBytes, name)
    assert.equal(data.get(shoppingListProgressStorageKey), 'legacy-v1-do-not-touch', name)
    assert.deepEqual(writes, [], name)
    assert.ok(reads.length > 0, name)
    assert.equal(reads.includes(shoppingListProgressStorageKey), false, name)
  }

  assert.deepEqual(original, originalSnapshot, 'read-only QA may not mutate the canonical M2 basket')
})

test('QA #1603: a price-only UI refresh never unlocks a protected future record', () => {
  const initial = basket()
  const protectedBytes = '{"schemaVersion":4,"opaque":"preserve"}'
  const data = new Map([[shoppingListProgressV2StorageKey, protectedBytes]])
  const writes = []
  const storage = {
    getItem(key) { return data.get(key) ?? null },
    setItem(key, value) { writes.push([key, value]); data.set(key, value) },
  }
  const controller = openShoppingProgressStorageV2(initial, storage)
  const repriced = structuredClone(initial)
  repriced.totalCents += 1
  controller.rebase(repriced)
  controller.toggle(repriced.lines[0].id)
  assert.equal(controller.persist(), false)
  assert.equal(controller.storageFormatStatus(), 'unknown-record')
  assert.deepEqual(writes, [])
  assert.equal(data.get(shoppingListProgressV2StorageKey), protectedBytes)
})
