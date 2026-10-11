import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Independent postrepair product-core #1603 acceptance, separate from the
// five intentional-RED tests. In-memory fixture only, not browser CAS proof.
const base = { store: m2Store, products: m2Products, recipes: m2Recipes, plan: m2InitialPlan }
const basketA = buildOneStoreBasket({ ...base, activeDays: ['Di'] })
const basketB = buildOneStoreBasket({ ...base, activeDays: ['Di', 'Wo'] })
const idA = basketA.lines.find((line) => line.status === 'matched')?.id
assert.ok(idA)
const emptyA = serializeShoppingProgressV2(basketA, [])
const checkedA = serializeShoppingProgressV2(basketA, [idA])
const emptyB = serializeShoppingProgressV2(basketB, [])
assert.ok(emptyA)
assert.ok(checkedA)
assert.ok(emptyB)
const demandA = JSON.parse(emptyA).demandIdentity

function port(value) {
  let writes = 0
  const values = new Map([[key, value]])
  return {
    values,
    get writes() { return writes },
    getItem(k) { return values.get(k) ?? null },
    setItem(k, v) { writes++; values.set(k, v) },
  }
}

test('Product postrepair: opaque physical identity survives clear, store switch and user tick', () => {
  const raw = JSON.stringify({ schemaVersion: 2, demandIdentity: 'opaque-task', doneLineIds: [] })
  const storage = port(raw)
  const controller = openShoppingProgressStorageV2(basketA, storage)
  controller.clear()
  assert.equal(controller.persist(), false)
  controller.rebase(basketB)
  const nextId = basketB.lines.find((line) => line.status === 'matched')?.id
  assert.ok(nextId)
  controller.toggle(nextId)
  assert.equal(controller.persist(), false)
  assert.equal(storage.values.get(key), raw)
  assert.equal(storage.writes, 0)
})

test('Product postrepair: corrected same-demand revision is recovered read-only before saving', () => {
  const raw = JSON.stringify({ schemaVersion: 2, demandIdentity: '{broken', doneLineIds: [] })
  const storage = port(raw)
  const controller = openShoppingProgressStorageV2(basketA, storage)
  controller.toggle(idA)
  storage.values.set(key, emptyA)
  assert.equal(controller.persist(), false)
  const recovered = controller.reloadSaved()
  assert.ok(recovered)
  assert.deepEqual(recovered.completedLineIds, [])
  assert.equal(storage.writes, 0)
  controller.toggle(idA)
  assert.equal(controller.persist(), true)
  assert.equal(storage.values.get(key), checkedA)
  assert.equal(storage.writes, 1)
})

test('Product postrepair: canonical foreign v2 remains a deliberate switch option', () => {
  const storage = port(emptyB)
  const controller = openShoppingProgressStorageV2(basketA, storage)
  assert.equal(controller.storageFormatStatus(), 'ready')
  controller.toggle(idA)
  assert.equal(controller.persist(), true)
  assert.equal(JSON.parse(storage.values.get(key)).demandIdentity, demandA)
  assert.equal(storage.writes, 1)
})

test('Product postrepair: foreign physical identity with duplicate lines is protected', () => {
  const identity = JSON.parse(demandA)
  assert.ok(identity.lines.length > 0)
  const malformed = JSON.stringify({ ...identity, storeId: 'different-shop', lines: [...identity.lines, identity.lines[0]] })
  const raw = JSON.stringify({ schemaVersion: 2, demandIdentity: malformed, doneLineIds: [] })
  const storage = port(raw)
  const controller = openShoppingProgressStorageV2(basketA, storage)
  assert.equal(controller.storageFormatStatus(), 'unknown-record')
  controller.toggle(idA)
  assert.equal(controller.persist(), false)
  assert.equal(storage.values.get(key), raw)
  assert.equal(storage.writes, 0)
})

test('Product postrepair: noncanonical foreign demand JSON whitespace cannot be silently normalized', () => {
  const identity = JSON.parse(emptyB).demandIdentity
  const nonCanonical = JSON.stringify(JSON.parse(identity), null, 2)
  assert.notEqual(nonCanonical, identity)
  const raw = JSON.stringify({ schemaVersion: 2, demandIdentity: nonCanonical, doneLineIds: [] })
  const storage = port(raw)
  const controller = openShoppingProgressStorageV2(basketA, storage)
  assert.equal(controller.storageFormatStatus(), 'unknown-record')
  controller.toggle(idA)
  assert.equal(controller.persist(), false)
  assert.equal(storage.values.get(key), raw)
  assert.equal(storage.writes, 0)
})
