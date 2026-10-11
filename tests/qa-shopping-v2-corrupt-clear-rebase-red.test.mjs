import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// QA-only add-on to immutable, intentionally RED #1638 (issue #1603).
// This tests additional destructive transitions, not retailer/browser storage.
const basket = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: ['Di'],
})
const line = basket.lines.find((row) => row.status === 'matched')?.id
assert.ok(line)
const validRaw = serializeShoppingProgressV2(basket, [line])
assert.ok(validRaw)

function disk(raw) {
  let writes = 0
  const values = new Map([[key, raw]])
  return {
    values,
    get writes() { return writes },
    getItem(k) { return values.get(k) ?? null },
    setItem(k, v) { writes++; values.set(k, v) },
  }
}

test('QA #1603: explicit clear cannot destroy a semantically invalid saved v2 record', () => {
  const raw = JSON.stringify({ ...JSON.parse(validRaw), doneLineIds: [line, line] })
  const storage = disk(raw)
  const controller = openShoppingProgressStorageV2(basket, storage)
  controller.clear()
  assert.deepEqual(controller.snapshot().completedLineIds, [])
  assert.equal(controller.persist(), false, 'clear does not authorize discarding unsupported original bytes')
  assert.equal(storage.values.get(key), raw)
  assert.equal(storage.writes, 0)
})

test('QA #1603: rebase must not make an unsupported same-demand checklist writable', () => {
  const raw = JSON.stringify({ ...JSON.parse(validRaw), doneLineIds: [line, 'synthetic-unrecognized-id'] })
  const storage = disk(raw)
  const controller = openShoppingProgressStorageV2(basket, storage)
  controller.rebase(basket)
  controller.toggle(line)
  assert.equal(controller.persist(), false, 'rebase must not silently normalize unsupported durable state')
  assert.equal(storage.values.get(key), raw)
  assert.equal(storage.writes, 0)
})

test('QA #1603: valid checklist may still be deliberately cleared and saved', () => {
  const storage = disk(validRaw)
  const controller = openShoppingProgressStorageV2(basket, storage)
  assert.equal(controller.storageFormatStatus(), 'ready')
  controller.clear()
  assert.equal(controller.persist(), true)
  assert.deepEqual(JSON.parse(storage.values.get(key)).doneLineIds, [])
  assert.equal(storage.writes, 1)
})
