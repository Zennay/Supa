import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as v2Key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { shoppingListProgressStorageKey as v1Key } from '../src/features/shopping-list/shoppingListProgress.ts'

// Product-core #1603: model intentional checklist actions separately from
// untrusted external storage revisions. All values are synthetic; no browser
// CAS, retailer prices, user records or field evidence are implied.
const inputs = {
  store: m2Store, products: m2Products, recipes: m2Recipes, plan: m2InitialPlan,
}
const basket = buildOneStoreBasket({ ...inputs, activeDays: ['Di'] })
const differentBasket = buildOneStoreBasket({ ...inputs, activeDays: ['Di', 'Wo'] })
const tick = basket.lines.find((line) => line.status === 'matched')?.id
assert.ok(tick)
const emptyV2 = serializeShoppingProgressV2(basket, [])
const checkedV2 = serializeShoppingProgressV2(basket, [tick])
assert.ok(emptyV2)
assert.ok(checkedV2)
const identity = JSON.parse(emptyV2).demandIdentity
const future = JSON.stringify({ schemaVersion: 3, demandIdentity: identity, doneLineIds: [tick] })

function disk(initial = future) {
  const values = new Map([[v2Key, initial], [v1Key, 'legacy-must-not-be-read']])
  const reads = []
  const writes = []
  return {
    values, reads, writes,
    getItem(key) { reads.push(key); return values.get(key) ?? null },
    setItem(key, value) { writes.push([key, value]); values.set(key, value) },
  }
}

test('Product #1603: opening future v2 never falls back to legacy, even with opt-in', () => {
  const storage = disk()
  const controller = openShoppingProgressStorageV2(basket, storage, { allowLegacyUpgrade: true })
  assert.deepEqual(storage.reads, [v2Key])
  assert.equal(controller.storageFormatStatus(), 'unknown-record')
  controller.toggle(tick)
  assert.deepEqual(controller.snapshot().completedLineIds, [tick])
  assert.equal(controller.persist(), false)
  assert.equal(storage.values.get(v2Key), future)
  assert.equal(storage.values.get(v1Key), 'legacy-must-not-be-read')
  assert.deepEqual(storage.writes, [])
})

test('Product #1603: clearing a protected record cannot bypass protection via rebase', () => {
  const invalid = '{"schemaVersion":2,"demandIdentity":'
  const storage = disk(invalid)
  const controller = openShoppingProgressStorageV2(basket, storage)
  controller.clear()
  controller.rebase(differentBasket)
  const otherTick = differentBasket.lines.find((line) => line.status === 'matched')?.id
  assert.ok(otherTick)
  controller.toggle(otherTick)
  assert.equal(controller.persist(), false)
  assert.equal(controller.storageFormatStatus(), 'unknown-record')
  assert.equal(storage.values.get(v2Key), invalid)
  assert.deepEqual(storage.writes, [])
})

test('Product #1603: a corrected same-demand external v2 needs manual read before saving', () => {
  const storage = disk()
  const controller = openShoppingProgressStorageV2(basket, storage)
  controller.toggle(tick)
  storage.values.set(v2Key, emptyV2)
  assert.equal(controller.persist(), false)
  assert.equal(controller.storageFormatStatus(), 'unknown-record')
  const recovered = controller.reloadSaved()
  assert.ok(recovered)
  assert.deepEqual(recovered.completedLineIds, [])
  assert.equal(controller.storageFormatStatus(), 'ready')
  controller.toggle(tick)
  assert.equal(controller.persist(), true)
  assert.equal(storage.values.get(v2Key), checkedV2)
  assert.deepEqual(storage.writes.map(([key]) => key), [v2Key])
})

test('Product #1603: corrected but foreign-demand saved value stays protected', () => {
  const foreign = serializeShoppingProgressV2(differentBasket, [])
  assert.ok(foreign)
  const storage = disk()
  const controller = openShoppingProgressStorageV2(basket, storage)
  controller.toggle(tick)
  storage.values.set(v2Key, foreign)
  assert.equal(controller.reloadSaved(), null)
  assert.deepEqual(controller.snapshot().completedLineIds, [tick])
  assert.equal(controller.persist(), false)
  assert.equal(storage.values.get(v2Key), foreign)
  assert.deepEqual(storage.writes, [])
})

test('Product #1603: external removal permits a deliberate new physical task without data loss', () => {
  const storage = disk()
  const controller = openShoppingProgressStorageV2(basket, storage)
  storage.values.delete(v2Key)
  assert.ok(controller.reloadSaved())
  assert.equal(controller.storageFormatStatus(), 'ready')
  controller.rebase(differentBasket)
  assert.deepEqual(controller.snapshot().completedLineIds, [])
  assert.equal(controller.persist(), true)
  assert.equal(JSON.parse(storage.values.get(v2Key)).demandIdentity,
    JSON.parse(serializeShoppingProgressV2(differentBasket, [])).demandIdentity)
  assert.deepEqual(storage.writes.map(([key]) => key), [v2Key])
})

test('Product #1603: an outer duplicate is detected after nested metadata and escaped contents', () => {
  const disguised = `{"schemaVersion":3,"metadata":{"a":[{"schemaVersion":99}],"text":"} \\"schemaVersion\\":3"},"doneLineIds":[],"schemaVersion":2,"demandIdentity":${JSON.stringify(identity)}}`
  const storage = disk(disguised)
  const controller = openShoppingProgressStorageV2(basket, storage)
  assert.equal(controller.storageFormatStatus(), 'unknown-record')
  controller.toggle(tick)
  assert.equal(controller.persist(), false)
  assert.equal(storage.values.get(v2Key), disguised)
  assert.deepEqual(storage.writes, [])
})
