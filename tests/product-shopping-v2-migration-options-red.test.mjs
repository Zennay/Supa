import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { serializeShoppingProgressV2, shoppingListProgressV2StorageKey as v2Key } from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { serializeShoppingListProgress, shoppingListProgressStorageKey as v1Key } from '../src/features/shopping-list/shoppingListProgress.ts'

// Synthetic product #1056: external runtime StorageOptions is not necessarily a
// plain TypeScript object. Its getter should never crash opening the checklist.
const basket = buildOneStoreBasket({
  store: m2Store, products: m2Products, plan: m2InitialPlan,
  activeDays: ['Di'], recipes: m2Recipes,
})
const id = basket.lines.find(row => row.status === 'matched')?.id
assert.ok(id)
const validV2 = serializeShoppingProgressV2(basket, [id])
const validV1 = serializeShoppingListProgress(basket, [id])
assert.ok(validV2)
assert.ok(validV1)

function port(v2Value) {
  const values = new Map([[v1Key, validV1]])
  if (v2Value !== null) values.set(v2Key, v2Value)
  let writes = 0
  return {
    get writes() { return writes },
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { writes++; values.set(key, value) },
  }
}

test('Product #1056 expected RED: second migration-option getter failure must not crash initial v1 read', () => {
  let accesses = 0
  const options = {
    get allowLegacyUpgrade() {
      accesses++
      if (accesses === 1) return true
      throw new Error('synthetic runtime option revoked after read')
    },
  }
  const storage = port(null)
  const controller = assert.doesNotThrow(() =>
    openShoppingProgressStorageV2(basket, storage, options))
  // assert.doesNotThrow returns undefined on success; re-open only if test is GREEN.
  assert.equal(accesses, 1)
  assert.equal(storage.writes, 0)
  void controller
})

test('Product #1056 expected RED: existing v2 must not read throwing migration option outside guarded preflight', () => {
  const storage = port(validV2)
  let accesses = 0
  const options = { get allowLegacyUpgrade() { accesses++; throw new Error('synthetic guarded getter') } }
  assert.doesNotThrow(() => {
    const controller = openShoppingProgressStorageV2(basket, storage, options)
    assert.equal(controller.storageFormatStatus(), 'ready')
  })
  assert.equal(storage.writes, 0)
  assert.equal(accesses, 0, 'migration consent is irrelevant when v2 already exists')
})

test('Product #1056 expected RED: explicit null options must behave like no upgrade consent', () => {
  const storage = port(validV2)
  assert.doesNotThrow(() => {
    const c = openShoppingProgressStorageV2(basket, storage, null)
    assert.deepEqual(c.snapshot().completedLineIds, [id])
  })
  assert.equal(storage.writes, 0)
})

test('Product #1056 control: stable consent getter is inspected at most once', () => {
  let accesses = 0
  const storage = port(null)
  const options = { get allowLegacyUpgrade() { accesses++; return true } }
  const controller = openShoppingProgressStorageV2(basket, storage, options)
  assert.deepEqual(controller.snapshot().completedLineIds, [id])
  assert.equal(controller.snapshot().upgradedFromLegacy, true)
  assert.equal(storage.writes, 0)
  assert.equal(accesses, 1, 'a snapshot must pin consent, not reread a mutable option getter')
})

test('Product #1056 control: existing supported v2 ignores normal migration consent', () => {
  const storage = port(validV2)
  const c = openShoppingProgressStorageV2(basket, storage, { allowLegacyUpgrade: true })
  assert.deepEqual(c.snapshot().completedLineIds, [id])
  assert.equal(c.snapshot().upgradedFromLegacy, false)
  assert.equal(storage.writes, 0)
})
