import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Synthetic QA for existing forward-preservation issue #1603. This test only
// probes staged shopping-v2 controller behavior; no browser storage or prices.
const basket = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: ['Di'],
})
const validLine = basket.lines.find((line) => line.status === 'matched')?.id
assert.ok(validLine)
const canonical = serializeShoppingProgressV2(basket, [validLine])
assert.ok(canonical)

function port(raw) {
  const values = new Map([[key, raw]])
  let writes = 0
  return {
    values,
    get writes() { return writes },
    getItem(k) { return values.get(k) ?? null },
    setItem(k, value) { writes++; values.set(k, value) },
  }
}

test('QA #1603: duplicate completed-line IDs in same-demand v2 must not be normalized and overwritten', () => {
  const raw = JSON.stringify({
    ...JSON.parse(canonical),
    doneLineIds: [validLine, validLine],
  })
  const disk = port(raw)
  const controller = openShoppingProgressStorageV2(basket, disk)
  assert.equal(controller.storageFormatStatus(), 'unknown-record',
    'unsupported v2 checklist shape must be protected, not treated as writable')
  controller.toggle(validLine)
  assert.equal(controller.persist(), false)
  assert.equal(disk.values.get(key), raw, 'unknown record must remain byte-for-byte intact')
  assert.equal(disk.writes, 0)
})

test('QA #1603: unknown same-demand line ID must not be silently dropped before a later overwrite', () => {
  const raw = JSON.stringify({
    ...JSON.parse(canonical),
    doneLineIds: [validLine, 'synthetic-future-line-id'],
  })
  const disk = port(raw)
  const controller = openShoppingProgressStorageV2(basket, disk)
  assert.equal(controller.storageFormatStatus(), 'unknown-record')
  controller.toggle(validLine)
  assert.equal(controller.persist(), false)
  assert.equal(disk.values.get(key), raw)
  assert.equal(disk.writes, 0)
})

test('QA #1603: an externally replaced semantically invalid snapshot must never be adopted by read-only recovery', () => {
  const disk = port(canonical)
  const controller = openShoppingProgressStorageV2(basket, disk)
  const raw = JSON.stringify({
    ...JSON.parse(canonical),
    doneLineIds: [validLine, 'synthetic-future-line-id'],
  })
  disk.values.set(key, raw)
  assert.equal(controller.reloadSaved({ requireSameDemand: true }), null)
  controller.toggle(validLine)
  assert.equal(controller.persist(), false)
  assert.equal(disk.values.get(key), raw)
  assert.equal(disk.writes, 0)
})

test('QA #1603: valid same-demand v2 still restores and deliberately saves a tick', () => {
  const disk = port(canonical)
  const controller = openShoppingProgressStorageV2(basket, disk)
  assert.equal(controller.storageFormatStatus(), 'ready')
  assert.deepEqual(controller.snapshot().completedLineIds, [validLine])
  controller.toggle(validLine)
  assert.equal(controller.persist(), true)
  assert.deepEqual(JSON.parse(disk.values.get(key)).doneLineIds, [])
  assert.equal(disk.writes, 1)
})
