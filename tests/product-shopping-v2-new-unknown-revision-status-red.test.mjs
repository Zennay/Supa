import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Expected-RED product UX contract on frozen DRAFT #1690. Fictional storage only.
// A stale save must distinguish a newer, supported revision from an unsupported
// future/corrupt revision *without overwriting* the real bytes.
const basket = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: ['Di'],
})
const id = basket.lines.find(line => line.status === 'matched')?.id
assert.ok(id)
const supported = serializeShoppingProgressV2(basket, [id])
assert.ok(supported)

function disk() {
  const values = new Map()
  const writes = []
  return {
    values, writes,
    getItem(k) { return values.get(k) ?? null },
    setItem(k, v) { writes.push([k, v]); values.set(k, v) },
  }
}

for (const raw of [
  '{"schemaVersion":4,"future":{"preserve":"all"}}',
  '{invalid json',
  JSON.stringify({ ...JSON.parse(supported), syncEnvelope: { author: 'later-client' } }),
]) {
  test('Product #1603 expected RED: newer unsupported revision is diagnosed after stale save: ' + raw, () => {
    const storage = disk()
    const controller = openShoppingProgressStorageV2(basket, storage)
    assert.equal(controller.storageFormatStatus(), 'ready')
    controller.toggle(id)
    storage.values.set(key, raw)
    assert.equal(controller.persist(), false)
    assert.equal(storage.values.get(key), raw)
    assert.deepEqual(storage.writes, [])
    assert.equal(controller.storageFormatStatus(), 'unknown-record',
      'UI should announce protected future/corrupt data, not only a generic stale-tab conflict')
    assert.equal(controller.reloadSaved(), null)
    assert.equal(storage.values.get(key), raw)
  })
}

test('Product #1603 control: a newer supported same-demand revision is a recoverable stale conflict', () => {
  const storage = disk()
  const controller = openShoppingProgressStorageV2(basket, storage)
  controller.toggle(id)
  storage.values.set(key, supported)
  assert.equal(controller.persist(), false)
  assert.equal(controller.storageFormatStatus(), 'ready')
  assert.deepEqual(controller.reloadSaved()?.completedLineIds, [id])
  assert.equal(controller.storageFormatStatus(), 'ready')
  assert.deepEqual(storage.writes, [])
})

test('Product #1603 control: protected revision may recover only after external same-demand repair', () => {
  const storage = disk()
  const controller = openShoppingProgressStorageV2(basket, storage)
  controller.toggle(id)
  storage.values.set(key, '{"schemaVersion":5}')
  assert.equal(controller.persist(), false)
  storage.values.set(key, supported)
  assert.deepEqual(controller.reloadSaved()?.completedLineIds, [id])
  assert.equal(controller.storageFormatStatus(), 'ready')
  assert.deepEqual(storage.writes, [])
})
