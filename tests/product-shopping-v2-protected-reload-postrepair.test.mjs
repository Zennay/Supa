import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Postrepair controller acceptance. Injected storage is intentionally not
// a replacement for permanent Firefox/mobile cross-tab checks.
const basketA = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: ['Di'],
})
const line = basketA.lines.find((row) => row.status === 'matched')?.id
assert.ok(line)
const basketB = {
  ...basketA,
  store: { ...basketA.store, id: 'synthetic-store-b' },
}
const validA = serializeShoppingProgressV2(basketA, [line])
const validB = serializeShoppingProgressV2(basketB, [line])
assert.ok(validA && validB)

function disk(raw) {
  let writes = 0
  const contents = new Map([[key, raw]])
  return {
    contents,
    get writes() { return writes },
    getItem(k) { return contents.get(k) ?? null },
    setItem(k, value) { writes++; contents.set(k, value) },
  }
}

function makeProtectedController(storage) {
  const c = openShoppingProgressStorageV2(basketB, storage)
  c.rebase(basketA)
  assert.equal(c.storageFormatStatus(), 'unknown-record')
  c.rebase(basketB)
  assert.equal(c.storageFormatStatus(), 'unknown-record')
  return c
}

test('Product #1603: ordinary recovery from protected foreign record must remain read-only and rejected', () => {
  const malformedA = JSON.stringify({
    ...JSON.parse(validA),
    doneLineIds: [line, 'synthetic-future-only'],
  })
  const storage = disk(malformedA)
  const c = makeProtectedController(storage)
  storage.contents.set(key, validA)
  const old = c.snapshot()
  assert.equal(c.reloadSaved(), null)
  assert.deepEqual(c.snapshot().completedLineIds, old.completedLineIds)
  assert.equal(c.storageFormatStatus(), 'unknown-record')
  assert.equal(c.persist(), false)
  assert.equal(storage.writes, 0)
  assert.equal(storage.contents.get(key), validA)
})

test('Product #1603: deliberate recovery after deleted v2 record can reset protected state safely', () => {
  const storage = disk(JSON.stringify({
    ...JSON.parse(validA),
    doneLineIds: [line, 'synthetic-future-only'],
  }))
  const c = makeProtectedController(storage)
  storage.contents.delete(key)
  assert.ok(c.reloadSaved(), 'explicit read-only reload of absent v2 is safe')
  assert.equal(c.storageFormatStatus(), 'ready')
  assert.equal(storage.writes, 0)
  c.toggle(line)
  assert.equal(c.persist(), true)
  assert.deepEqual(JSON.parse(storage.contents.get(key)).doneLineIds, [line])
  assert.equal(storage.writes, 1)
})

test('Product #1603: deliberate brand-new physical B controller remains writable', () => {
  const storage = disk(validA)
  const c = openShoppingProgressStorageV2(basketB, storage)
  assert.equal(c.storageFormatStatus(), 'ready')
  c.toggle(line)
  assert.equal(c.persist(), true)
  assert.equal(storage.writes, 1)
  assert.equal(JSON.parse(storage.contents.get(key)).demandIdentity, JSON.parse(validB).demandIdentity)
})
