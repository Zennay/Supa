import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Independent synthetic conflict matrix against repaired shopping-v2 storage.
// No claim of atomic localStorage CAS or multi-browser proof.
const basket = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: ['Di'],
})
const tick = basket.lines.find((line) => line.status === 'matched')?.id
assert.ok(tick)
const valid = serializeShoppingProgressV2(basket, [])
assert.ok(valid)
const identity = JSON.parse(valid).demandIdentity
const ambiguous = `{"schemaVersion":3,"schemaVersion":2,"demandIdentity":${JSON.stringify(identity)},"doneLineIds":[]}`

function disk() {
  let writes = 0
  const values = new Map([[key, valid]])
  return {
    values,
    get writes() { return writes },
    getItem(k) { return values.get(k) ?? null },
    setItem(k, v) { writes++; values.set(k, v) },
  }
}

test('Product #1603: external malformed revision cannot replace an unsaved tick via manual reload', () => {
  const storage = disk()
  const c = openShoppingProgressStorageV2(basket, storage)
  c.toggle(tick)
  const before = c.snapshot()
  storage.values.set(key, ambiguous)
  assert.equal(c.reloadSaved(), null)
  assert.deepEqual(c.snapshot().completedLineIds, before.completedLineIds)
  assert.equal(c.persist(), false)
  assert.equal(storage.values.get(key), ambiguous)
  assert.equal(storage.writes, 0)
})

test('Product #1603: stale revision plus manual clear must never overwrite externally ambiguous bytes', () => {
  const storage = disk()
  const c = openShoppingProgressStorageV2(basket, storage)
  storage.values.set(key, ambiguous)
  c.clear()
  assert.equal(c.persist(), false)
  assert.equal(c.reloadSaved({requireSameDemand: true}), null)
  assert.equal(c.persist(), false)
  assert.equal(storage.values.get(key), ambiguous)
  assert.equal(storage.writes, 0)
})

test('Product #1603: duplicate unknown extension root keys protect saved bytes even with valid v2 envelope', () => {
  const raw = `{"schemaVersion":2,"demandIdentity":${JSON.stringify(identity)},"doneLineIds":[],"futureExt":1,"futureExt":2}`
  const storage = disk()
  storage.values.set(key, raw)
  const c = openShoppingProgressStorageV2(basket, storage)
  assert.equal(c.storageFormatStatus(), 'unknown-record')
  c.toggle(tick)
  assert.equal(c.persist(), false)
  assert.equal(storage.values.get(key), raw)
  assert.equal(storage.writes, 0)
})

test('Product #1603: escaped quotes and backslashes inside a unique optional field are not root keys', () => {
  const raw = JSON.stringify({
    ...JSON.parse(valid),
    futureDescription: String.raw`literal \\ and {"schemaVersion":3} and "doneLineIds":[]`,
  })
  const storage = disk()
  storage.values.set(key, raw)
  const c = openShoppingProgressStorageV2(basket, storage)
  assert.equal(c.storageFormatStatus(), 'ready')
  c.toggle(tick)
  assert.equal(c.persist(), true)
  assert.deepEqual(JSON.parse(storage.values.get(key)).doneLineIds, [tick])
  assert.equal(storage.writes, 1)
})
