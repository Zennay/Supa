import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// A JSON parser uses the LAST occurrence of a duplicated object property.
// Older clients must not overwrite the original, ambiguous durable bytes.
// This is synthetic malformed input, not evidence of actual user data loss.
const basket = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: ['Di'],
})
const lineId = basket.lines.find((row) => row.status === 'matched')?.id
assert.ok(lineId)
const valid = serializeShoppingProgressV2(basket, [])
assert.ok(valid)
const identity = JSON.parse(valid).demandIdentity

function storageFor(raw) {
  const values = new Map([[key, raw]])
  let writes = 0
  return {
    values,
    get writes() { return writes },
    getItem(k) { return values.get(k) ?? null },
    setItem(k, v) { writes++; values.set(k, v) },
  }
}

const conflictingRecords = [
  [
    'duplicate schemaVersion hides a future schema behind v2',
    `{"schemaVersion":3,"schemaVersion":2,"demandIdentity":${JSON.stringify(identity)},"doneLineIds":[]}`,
  ],
  [
    'duplicate demandIdentity hides a foreign physical shopping task',
    `{"schemaVersion":2,"demandIdentity":"future-foreign-task","demandIdentity":${JSON.stringify(identity)},"doneLineIds":[]}`,
  ],
  [
    'duplicate doneLineIds hides unsupported saved checkmarks',
    `{"schemaVersion":2,"demandIdentity":${JSON.stringify(identity)},"doneLineIds":["unknown-future-line"],"doneLineIds":[]}`,
  ],
]

for (const [label, raw] of conflictingRecords) {
  test(`Product #1603: ${label} (preserve original bytes)`, () => {
    const disk = storageFor(raw)
    const controller = openShoppingProgressStorageV2(basket, disk)
    assert.equal(controller.storageFormatStatus(), 'unknown-record')
    controller.toggle(lineId)
    assert.equal(controller.persist(), false)
    assert.equal(disk.writes, 0)
    assert.equal(disk.values.get(key), raw)
  })
}

test('Product #1603 control: normal unambiguous v2 remains writable', () => {
  const disk = storageFor(valid)
  const controller = openShoppingProgressStorageV2(basket, disk)
  assert.equal(controller.storageFormatStatus(), 'ready')
  controller.toggle(lineId)
  assert.equal(controller.persist(), true)
  assert.deepEqual(JSON.parse(disk.values.get(key)).doneLineIds, [lineId])
  assert.equal(disk.writes, 1)
})
