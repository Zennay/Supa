import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Independent postrepair acceptance on synthetic memory-only storage.
// No real retailer, participant, multi-tab atomicity or browser coverage.
const basket = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: ['Di'],
})
const line = basket.lines.find((item) => item.status === 'matched')?.id
assert.ok(line)
const valid = serializeShoppingProgressV2(basket, [])
assert.ok(valid)
const identity = JSON.parse(valid).demandIdentity

function disk(raw) {
  const values = new Map([[key, raw]])
  let writes = 0
  return {
    values,
    get writes() { return writes },
    getItem(k) { return values.get(k) ?? null },
    setItem(k, value) { writes++; values.set(k, value) },
  }
}

test('Product #1603: JSON escaped duplicate version key remains protected', () => {
  const raw = `{"schema\\u0056ersion":3,"schemaVersion":2,"demandIdentity":${JSON.stringify(identity)},"doneLineIds":[]}`
  const storage = disk(raw)
  const c = openShoppingProgressStorageV2(basket, storage)
  assert.equal(c.storageFormatStatus(), 'unknown-record')
  c.clear()
  assert.equal(c.persist(), false)
  assert.equal(storage.writes, 0)
  assert.equal(storage.values.get(key), raw)
})

test('Product #1603: JSON escaped duplicate demand identity remains protected on rebase', () => {
  const raw = `{"schemaVersion":2,"demand\\u0049dentity":"foreign","demandIdentity":${JSON.stringify(identity)},"doneLineIds":[]}`
  const storage = disk(raw)
  const c = openShoppingProgressStorageV2(basket, storage)
  assert.equal(c.storageFormatStatus(), 'unknown-record')
  c.rebase({...basket})
  c.toggle(line)
  assert.equal(c.persist(), false)
  assert.equal(storage.values.get(key), raw)
  assert.equal(storage.writes, 0)
})

test('Product #1603: explicit same-demand recovery from corrected bytes is read-only', () => {
  const ambiguous = `{"schemaVersion":3,"schemaVersion":2,"demandIdentity":${JSON.stringify(identity)},"doneLineIds":[]}`
  const storage = disk(ambiguous)
  const c = openShoppingProgressStorageV2(basket, storage)
  assert.equal(c.storageFormatStatus(), 'unknown-record')
  storage.values.set(key, valid)
  assert.ok(c.reloadSaved({requireSameDemand: true}))
  assert.equal(storage.writes, 0)
  assert.equal(c.storageFormatStatus(), 'ready')
  c.toggle(line)
  assert.equal(c.persist(), true)
  assert.deepEqual(JSON.parse(storage.values.get(key)).doneLineIds, [line])
  assert.equal(storage.writes, 1)
})

test('Product #1603: escaped JSON text pretending to contain keys does not reject safe v2', () => {
  const validWithNote = JSON.stringify({
    ...JSON.parse(valid),
    note: 'not a root key: "schemaVersion":3, "doneLineIds":["foreign"]',
  })
  const storage = disk(validWithNote)
  const c = openShoppingProgressStorageV2(basket, storage)
  assert.equal(c.storageFormatStatus(), 'ready')
  c.toggle(line)
  assert.equal(c.persist(), true)
  assert.equal(storage.writes, 1)
})

test('Product #1603: harmless nested JSON object does not masquerade as root schema', () => {
  const validWithNestedMetadata = JSON.stringify({
    ...JSON.parse(valid),
    metadata: { schemaVersion: 99, demandIdentity: 'internal-note' },
  })
  const storage = disk(validWithNestedMetadata)
  const c = openShoppingProgressStorageV2(basket, storage)
  assert.equal(c.storageFormatStatus(), 'ready')
  c.toggle(line)
  assert.equal(c.persist(), true)
  assert.deepEqual(JSON.parse(storage.values.get(key)).doneLineIds, [line])
})

test('Product #1603: valid root JSON fields with whitespace remain writable', () => {
  const raw = `{ "schemaVersion" : 2, "demandIdentity" : ${JSON.stringify(identity)}, "doneLineIds" : [] }`
  const storage = disk(raw)
  const c = openShoppingProgressStorageV2(basket, storage)
  assert.equal(c.storageFormatStatus(), 'ready')
  c.toggle(line)
  assert.equal(c.persist(), true)
  assert.equal(storage.writes, 1)
})
