import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Synthetic safety regression: an explicitly protected controller should not
// normalize a now-foreign record by an ordinary reload before any failed save.
const a = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: ['Di'],
})
const line = a.lines.find((entry) => entry.status === 'matched')?.id
assert.ok(line)
const b = { ...a, store: { ...a.store, id: 'synthetic-different-store' } }
const savedA = serializeShoppingProgressV2(a, [line])
assert.ok(savedA)
const invalidA = JSON.stringify({
  ...JSON.parse(savedA),
  doneLineIds: [line, 'synthetic-future-line'],
})

function port(raw) {
  const entries = new Map([[key, raw]])
  let writes = 0
  return {
    entries,
    get writes() { return writes },
    getItem(k) { return entries.get(k) ?? null },
    setItem(k, v) { writes++; entries.set(k, v) },
  }
}

test('Product #1603/#1580: protected state must not adopt foreign durable identity on ordinary reload', () => {
  const disk = port(invalidA)
  const controller = openShoppingProgressStorageV2(b, disk)
  assert.equal(controller.storageFormatStatus(), 'ready', 'initial A record appears foreign to B')
  controller.rebase(a)
  assert.equal(controller.storageFormatStatus(), 'unknown-record')
  controller.rebase(b)
  assert.equal(controller.storageFormatStatus(), 'unknown-record')

  // Another client saves a *valid* A record. This is still a different physical
  // shopping task, not consent to roll its storage back into B.
  disk.entries.set(key, savedA)
  const localBefore = controller.snapshot().completedLineIds
  assert.equal(controller.reloadSaved(), null, 'ordinary reload must not pin foreign bytes after protected status')
  assert.deepEqual(controller.snapshot().completedLineIds, localBefore)
  assert.equal(controller.storageFormatStatus(), 'unknown-record')
  controller.toggle(line)
  assert.equal(controller.persist(), false)
  assert.equal(disk.entries.get(key), savedA)
  assert.equal(disk.writes, 0)
})

test('Product #1603/#1580: a new unprotected controller still permits a deliberate store switch', () => {
  const disk = port(savedA)
  const controller = openShoppingProgressStorageV2(b, disk)
  assert.equal(controller.storageFormatStatus(), 'ready')
  controller.toggle(line)
  assert.equal(controller.persist(), true)
  assert.equal(disk.writes, 1)
  assert.notEqual(JSON.parse(disk.entries.get(key)).demandIdentity, JSON.parse(savedA).demandIdentity)
})
