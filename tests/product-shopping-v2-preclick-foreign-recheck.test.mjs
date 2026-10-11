import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as v2Key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

const localBasket = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: ['Di'],
})
const first = localBasket.lines.find((line) => line.status === 'matched')?.id
assert.ok(first)
const foreignBasket = structuredClone(localBasket)
foreignBasket.store.id = 'synthetic-foreign-store'
const foreignBytes = serializeShoppingProgressV2(foreignBasket, [first])
assert.ok(foreignBytes)

function storage(initial) {
  const values = new Map([[v2Key, initial]])
  let writes = 0
  return {
    values,
    get writes() { return writes },
    getItem(key) { return values.get(key) ?? null },
    setItem(key, raw) { writes++; values.set(key, raw) },
  }
}

test('pre-tick protected recheck may not pin a different physical basket', () => {
  const future = JSON.stringify({ schemaVersion: 3, opaque: 'synthetic future data' })
  const disk = storage(future)
  const current = openShoppingProgressStorageV2(localBasket, disk)
  assert.equal(current.storageFormatStatus(), 'unknown-record')

  // A different tab intentionally creates a new physical store checklist.
  disk.values.set(v2Key, foreignBytes)
  assert.equal(current.reloadSaved({ requireSameDemand: true }), null,
    'manual recheck must not mistake the foreign saved task for an empty local checklist')
  assert.equal(disk.values.get(v2Key), foreignBytes)
  current.toggle(first)
  assert.equal(current.persist(), false,
    'the rejected read cannot silently pin the foreign revision for overwriting')
  assert.equal(disk.writes, 0)
  assert.equal(disk.values.get(v2Key), foreignBytes)
})

test('strict manual reload never adopts a foreign recognized v2 revision before a failed save', () => {
  const localBytes = serializeShoppingProgressV2(localBasket, [first])
  assert.ok(localBytes)
  const disk = storage(localBytes)
  const current = openShoppingProgressStorageV2(localBasket, disk)
  disk.values.set(v2Key, foreignBytes)
  assert.equal(current.reloadSaved({ requireSameDemand: true }), null)
  assert.deepEqual(current.snapshot().completedLineIds, [first])
  current.toggle(first)
  assert.equal(current.persist(), false)
  assert.equal(disk.values.get(v2Key), foreignBytes)
  assert.equal(disk.writes, 0)
})
