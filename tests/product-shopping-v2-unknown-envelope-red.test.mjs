import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as v2Key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Product-core #1603: a recognized v2 envelope with an unknown root field
// belongs to a potentially newer writer. Replacing it would erase information.
// Fictional M2 fixtures only; no real users, prices or browser CAS claim.
const base = { store: m2Store, products: m2Products, recipes: m2Recipes, plan: m2InitialPlan }
const current = buildOneStoreBasket({ ...base, activeDays: ['Di'] })
const other = buildOneStoreBasket({ ...base, activeDays: ['Di', 'Wo'] })
const tick = current.lines.find(line => line.status === 'matched')?.id
assert.ok(tick)
const cleanCurrent = serializeShoppingProgressV2(current, [tick])
const cleanOther = serializeShoppingProgressV2(other, [])
assert.ok(cleanCurrent)
assert.ok(cleanOther)

function disk(raw) {
  const data = new Map([[v2Key, raw]])
  let writes = 0
  return {
    data,
    get writes() { return writes },
    getItem(key) { return data.get(key) ?? null },
    setItem(key, value) { writes++; data.set(key, value) },
  }
}

const unknownRecords = [
  ['future sync token on same shopping task', current, cleanCurrent, { syncToken: 'future-revision-a' }],
  ['new field on legitimate foreign shopping task', current, cleanOther, { futureClientRevision: 7 }],
  ['null-valued extension is still unknown', current, cleanCurrent, { reservedNext: null }],
  ['nested owner-defined extension', current, cleanCurrent, { extension: { feature: 'planned', flags: [1, 2] } }],
  ['additional completion metadata', current, cleanCurrent, { completedAt: 'synthetic-not-a-real-time' }],
]
for (const [label, basket, raw, extra] of unknownRecords) {
  test('Product #1603 expected RED: preserve unknown v2 envelope: ' + label, () => {
    const stored = JSON.stringify({ ...JSON.parse(raw), ...extra })
    const storage = disk(stored)
    const controller = openShoppingProgressStorageV2(basket, storage)
    assert.equal(controller.storageFormatStatus(), 'unknown-record', 'unrecognized root field must be protected')
    controller.toggle(tick)
    assert.equal(controller.persist(), false)
    controller.clear()
    assert.equal(controller.persist(), false)
    controller.rebase(other)
    assert.equal(controller.persist(), false)
    assert.equal(storage.data.get(v2Key), stored, 'unknown future bytes must be retained exactly')
    assert.equal(storage.writes, 0)
  })
}

test('Product #1603 control: exactly supported v2 root remains editable', () => {
  const storage = disk(cleanCurrent)
  const controller = openShoppingProgressStorageV2(current, storage)
  assert.equal(controller.storageFormatStatus(), 'ready')
  controller.toggle(tick)
  assert.equal(controller.persist(), true)
  assert.equal(storage.data.get(v2Key), serializeShoppingProgressV2(current, []))
  assert.equal(storage.writes, 1)
})

test('Product #1603 control: a clean canonical foreign task remains switchable', () => {
  const storage = disk(cleanOther)
  const controller = openShoppingProgressStorageV2(current, storage)
  assert.equal(controller.storageFormatStatus(), 'ready')
  controller.toggle(tick)
  assert.equal(controller.persist(), true)
  assert.equal(storage.data.get(v2Key), cleanCurrent)
  assert.equal(storage.writes, 1)
})
