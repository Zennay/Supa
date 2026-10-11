import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Independent, add-only acceptance after narrow DRAFT source repair #1692.
// No live users, observations, retailer prices or browser-atomic-CAS claims.
const source = { store: m2Store, products: m2Products, recipes: m2Recipes, plan: m2InitialPlan }
const basket = buildOneStoreBasket({ ...source, activeDays: ['Di'] })
const otherBasket = buildOneStoreBasket({ ...source, activeDays: ['Di', 'Wo'] })
const checked = basket.lines.find(line => line.status === 'matched')?.id
assert.ok(checked)
const supported = serializeShoppingProgressV2(basket, [checked])
const foreign = serializeShoppingProgressV2(otherBasket, [])
assert.ok(supported && foreign)

function disk(initial = null) {
  const data = new Map()
  if (initial !== null) data.set(key, initial)
  const writes = []
  return {
    data, writes,
    getItem(k) { return data.get(k) ?? null },
    setItem(k, v) { writes.push([k, v]); data.set(k, v) },
  }
}

test('Product #1603: postrepair future v2 stays protected through rebase, clear and external repair', () => {
  const port = disk(supported)
  const controller = openShoppingProgressStorageV2(basket, port)
  controller.toggle(checked)
  const future = '{"schemaVersion":7,"nested":{"requiresNewClient":true}}'
  port.data.set(key, future)
  assert.equal(controller.persist(), false)
  assert.equal(controller.storageFormatStatus(), 'unknown-record')
  controller.clear()
  assert.equal(controller.persist(), false)
  controller.rebase(basket)
  assert.equal(controller.persist(), false)
  assert.equal(controller.reloadSaved(), null)
  assert.equal(port.data.get(key), future)
  assert.deepEqual(port.writes, [])

  // An external correction alone is insufficient: explicit read-only recovery
  // must run before this older controller may persist again.
  port.data.set(key, supported)
  assert.equal(controller.persist(), false)
  assert.deepEqual(controller.reloadSaved()?.completedLineIds, [checked])
  assert.equal(controller.storageFormatStatus(), 'ready')
  controller.toggle(checked)
  assert.equal(controller.persist(), true)
  assert.deepEqual(port.writes.map(([k]) => k), [key])
})

test('Product #1603: concurrent supported-v2 envelope with unknown root field remains opaque', () => {
  const port = disk()
  const controller = openShoppingProgressStorageV2(basket, port)
  controller.toggle(checked)
  const opaque = JSON.stringify({ ...JSON.parse(supported), futureReward: { currency: 'points' } })
  port.data.set(key, opaque)
  assert.equal(controller.persist(), false)
  assert.equal(controller.storageFormatStatus(), 'unknown-record')
  assert.equal(controller.reloadSaved(), null)
  assert.equal(port.data.get(key), opaque)
  assert.deepEqual(port.writes, [])
})

test('Product #1603: duplicate top-level durable field added by other tab is protected', () => {
  const port = disk()
  const controller = openShoppingProgressStorageV2(basket, port)
  controller.toggle(checked)
  const parsed = JSON.parse(supported)
  const ambiguous = '{"schemaVersion":4,' + JSON.stringify(parsed).slice(1)
  port.data.set(key, ambiguous)
  assert.equal(controller.persist(), false)
  assert.equal(controller.storageFormatStatus(), 'unknown-record')
  assert.equal(port.data.get(key), ambiguous)
  assert.deepEqual(port.writes, [])
})

test('Product #1580: a supported foreign physical switch is a normal stale conflict, not unknown', () => {
  const port = disk()
  const controller = openShoppingProgressStorageV2(basket, port)
  controller.toggle(checked)
  port.data.set(key, foreign)
  assert.equal(controller.persist(), false)
  assert.equal(controller.storageFormatStatus(), 'ready')
  assert.equal(controller.reloadSaved(), null, 'older physical task cannot adopt new task')
  assert.equal(port.data.get(key), foreign)
  assert.deepEqual(port.writes, [])
})
