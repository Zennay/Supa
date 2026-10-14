import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Independent acceptance of a durable foreign snapshot becoming same demand.
// Synthetic local port: not a cross-tab atomicity or browser test.
const a = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: ['Di'],
})
const line = a.lines.find((row) => row.status === 'matched')?.id
assert.ok(line)
const b = { ...a, store: { ...a.store, id: 'synthetic-other-store' } }
const rawA = serializeShoppingProgressV2(a, [line])
const rawB = serializeShoppingProgressV2(b, [line])
assert.ok(rawA && rawB)

function disk(raw) {
  const entries = new Map([[key, raw]])
  let writes = 0
  return {
    entries,
    get writes() { return writes },
    getItem(k) { return entries.get(k) ?? null },
    setItem(k, value) { writes++; entries.set(k, value) },
  }
}

test('Product #1603: protected status is sticky across rebase, clear and toggle until explicit supported reload', () => {
  const corruptA = JSON.stringify({
    ...JSON.parse(rawA),
    doneLineIds: [line, 'synthetic-unsupported-line'],
  })
  const storage = disk(corruptA)
  const controller = openShoppingProgressStorageV2(b, storage)
  assert.equal(controller.storageFormatStatus(), 'ready', 'unknown A IDs are foreign to active B')
  controller.rebase(a)
  assert.equal(controller.storageFormatStatus(), 'unknown-record')
  controller.rebase(b)
  controller.clear()
  controller.toggle(line)
  assert.equal(controller.storageFormatStatus(), 'unknown-record', 'switching back must not bypass protected state')
  assert.equal(controller.persist(), false)
  assert.equal(storage.entries.get(key), corruptA)
  assert.equal(storage.writes, 0)

  // Another client repairs the durable value for B. Only a user-invoked
  // same-demand read may deliberately recover the controller to writable.
  storage.entries.set(key, rawB)
  assert.ok(controller.reloadSaved({ requireSameDemand: true }))
  assert.equal(storage.writes, 0, 'reload is strictly read-only')
  assert.equal(controller.storageFormatStatus(), 'ready')
  controller.toggle(line)
  assert.equal(controller.persist(), true)
  assert.deepEqual(JSON.parse(storage.entries.get(key)).doneLineIds, [])
  assert.equal(storage.writes, 1)
})

test('Product #1603: duplicate same-demand IDs become protected during rebase, valid records remain usable', () => {
  const duplicate = JSON.stringify({
    ...JSON.parse(rawA),
    doneLineIds: [line, line],
  })
  const bad = disk(duplicate)
  const protectedSession = openShoppingProgressStorageV2(b, bad)
  assert.equal(protectedSession.storageFormatStatus(), 'unknown-record',
    'duplicate IDs are structurally ambiguous even for a foreign record')
  protectedSession.rebase(a)
  protectedSession.toggle(line)
  assert.equal(protectedSession.persist(), false)
  assert.equal(bad.entries.get(key), duplicate)
  assert.equal(bad.writes, 0)

  const good = disk(rawA)
  const allowedSession = openShoppingProgressStorageV2(b, good)
  allowedSession.rebase(a)
  assert.equal(allowedSession.storageFormatStatus(), 'ready')
  allowedSession.toggle(line)
  assert.equal(allowedSession.persist(), true)
  assert.equal(good.writes, 1)
})
