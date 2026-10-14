import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as v2Key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

const basket = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: ['Di'],
})
const item = basket.lines.find((line) => line.status === 'matched')?.id
assert.ok(item)

function transientlyDeniedStorage() {
  const values = new Map()
  let denyRead = true
  let writes = 0
  return {
    values,
    get writes() { return writes },
    allowReads() { denyRead = false },
    getItem(key) {
      if (denyRead) throw new Error('synthetic temporary read denial')
      return values.get(key) ?? null
    },
    setItem(key, value) { writes++; values.set(key, value) },
  }
}

test('a temporarily denied but present storage port offers a read-only retry, unlike absent storage', () => {
  const storage = transientlyDeniedStorage()
  const controller = openShoppingProgressStorageV2(basket, storage)
  assert.equal(controller.storageFormatStatus(), 'unavailable')
  assert.equal(controller.canRetryStorageRead(), true)
  assert.equal(openShoppingProgressStorageV2(basket, null).canRetryStorageRead(), false)

  controller.toggle(item)
  assert.equal(controller.persist(), false)
  assert.deepEqual(controller.snapshot().completedLineIds, [item])
  assert.equal(storage.writes, 0)
  assert.equal(controller.reloadSaved({ requireSameDemand: true }), null)
  assert.deepEqual(controller.snapshot().completedLineIds, [item],
    'denied retry cannot discard unsaved checks')
  assert.equal(storage.writes, 0)

  const saved = serializeShoppingProgressV2(basket, [item])
  assert.ok(saved)
  storage.values.set(v2Key, saved)
  storage.allowReads()
  const loaded = controller.reloadSaved({ requireSameDemand: true })
  assert.deepEqual(loaded?.completedLineIds, [item])
  assert.equal(controller.storageFormatStatus(), 'ready')
  assert.equal(storage.writes, 0, 'recovery must not write or import legacy data')
})

test('transient-denial retry must not adopt an externally saved foreign physical basket', () => {
  const storage = transientlyDeniedStorage()
  const controller = openShoppingProgressStorageV2(basket, storage)
  controller.toggle(item)
  const valid = serializeShoppingProgressV2(basket, [item])
  assert.ok(valid)
  const foreign = JSON.stringify({
    ...JSON.parse(valid),
    demandIdentity: 'synthetic:other-physical-store-and-demand',
  })
  storage.values.set(v2Key, foreign)
  storage.allowReads()
  assert.equal(controller.reloadSaved({ requireSameDemand: true }), null)
  assert.equal(controller.storageFormatStatus(), 'unavailable')
  assert.deepEqual(controller.snapshot().completedLineIds, [item])
  assert.equal(controller.persist(), false)
  assert.equal(storage.values.get(v2Key), foreign)
  assert.equal(storage.writes, 0)
})

test('unavailable banner exposes retry only for a recoverable port and uses strict read-only recovery', () => {
  const source = readFileSync(
    new URL('../src/features/shopping-list/ShoppingListViewV2.tsx', import.meta.url), 'utf8',
  )
  const unavailableBanner = source.split('{unavailableStorage && (')[1]
    ?.split('{saveFailed && (')[0]
  assert.ok(unavailableBanner, 'the actual staged view must show the unavailable status')
  assert.match(unavailableBanner, /controller\.canRetryStorageRead\(\)/,
    'do not offer an impossible retry when browser storage is null')
  assert.match(unavailableBanner, /onClick=\{retryUnavailableStorage\}/,
    'a temporarily denied read needs an explicit user recovery control')
  assert.match(source, /function retryUnavailableStorage\(\)[\s\S]*controller\.reloadSaved\(\{ requireSameDemand: true \}\)/,
    'recovery from an unavailable initial read must not take over another physical task')
  assert.match(source, /controller\.reloadSaved\(\{ requireSameDemand: unknownStoredRecord \}\)/,
    'the existing ordinary/protected reload contract must remain intact')
  assert.match(unavailableBanner, /zonder iets te bewaren|niets te bewaren/,
    'the control must explain that retry is read-only')
})
