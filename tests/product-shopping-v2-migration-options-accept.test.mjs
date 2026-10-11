import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { serializeShoppingProgressV2, shoppingListProgressV2StorageKey as v2Key } from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { serializeShoppingListProgress, shoppingListProgressStorageKey as v1Key } from '../src/features/shopping-list/shoppingListProgress.ts'

// Independent, add-only acceptance on frozen #1684. Fictional M2 baskets only.
const basket = buildOneStoreBasket({
  store: m2Store, products: m2Products, plan: m2InitialPlan,
  activeDays: ['Di'], recipes: m2Recipes,
})
const id = basket.lines.find(x => x.status === 'matched')?.id
assert.ok(id)
const v2 = serializeShoppingProgressV2(basket, [id])
const v1 = serializeShoppingListProgress(basket, [id])
assert.ok(v2)
assert.ok(v1)
function port(storedV2) {
  const values = new Map([[v1Key, v1]])
  if (storedV2 !== null) values.set(v2Key, storedV2)
  const reads = []
  let writes = 0
  return {
    reads,
    get writes() { return writes },
    getItem(k) { reads.push(k); return values.get(k) ?? null },
    setItem(k, value) { writes++; values.set(k, value) },
  }
}

test('Product #1056 independent: revoked migration-options Proxy cannot crash existing v2', () => {
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  const storage = port(v2)
  const controller = openShoppingProgressStorageV2(basket, storage, proxy)
  assert.deepEqual(controller.snapshot().completedLineIds, [id])
  assert.equal(controller.storageFormatStatus(), 'ready')
  assert.deepEqual(storage.reads, [v2Key], 'do not inspect irrelevant migration option or legacy key')
  assert.equal(storage.writes, 0)
})

test('Product #1056 independent: revoked Proxy with missing v2 disables migration safely', () => {
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  const storage = port(null)
  const controller = openShoppingProgressStorageV2(basket, storage, proxy)
  assert.equal(controller.storageFormatStatus(), 'unavailable')
  assert.deepEqual(controller.snapshot().completedLineIds, [])
  assert.equal(controller.persist(), false)
  assert.deepEqual(storage.reads, [v2Key])
  assert.equal(storage.writes, 0)
})

test('Product #1056 independent: changing consent getter only read once', () => {
  let count = 0
  const options = { get allowLegacyUpgrade() { return ++count === 1 } }
  const storage = port(null)
  const c = openShoppingProgressStorageV2(basket, storage, options)
  assert.equal(count, 1)
  assert.deepEqual(c.snapshot().completedLineIds, [id])
  assert.equal(c.snapshot().upgradedFromLegacy, true)
  assert.deepEqual(storage.reads, [v2Key, v1Key])
  assert.equal(storage.writes, 0)
})

test('Product #1056 independent: no consent means no hidden v1 read or write', () => {
  const storage = port(null)
  const c = openShoppingProgressStorageV2(basket, storage, { allowLegacyUpgrade: false })
  assert.deepEqual(c.snapshot().completedLineIds, [])
  assert.equal(c.snapshot().upgradedFromLegacy, false)
  assert.deepEqual(storage.reads, [v2Key])
  assert.equal(storage.writes, 0)
})

test('Product #1056 independent: explicit stable consent safely upgrades without initialization writes', () => {
  const storage = port(null)
  const c = openShoppingProgressStorageV2(basket, storage, { allowLegacyUpgrade: true })
  assert.deepEqual(c.snapshot().completedLineIds, [id])
  assert.equal(c.snapshot().upgradedFromLegacy, true)
  assert.equal(storage.writes, 0)
  assert.equal(c.persist(), true)
  assert.equal(storage.writes, 1)
})

test('Product #1056 independent: supported v2 wins over hostile legacy read and consent', () => {
  const storage = port(v2)
  const c = openShoppingProgressStorageV2(basket, storage, { allowLegacyUpgrade: true })
  assert.deepEqual(c.snapshot().completedLineIds, [id])
  assert.equal(c.snapshot().upgradedFromLegacy, false)
  assert.deepEqual(storage.reads, [v2Key])
  assert.equal(storage.writes, 0)
})
