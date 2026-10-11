import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as v2Key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'
import {
  serializeShoppingListProgress,
  shoppingListProgressStorageKey as v1Key,
} from '../src/features/shopping-list/shoppingListProgress.ts'

// Separate, fictional read-interleaving acceptance on frozen DRAFT #1685.
// No live retailer data, app entry points, or production migrations.
const basket = buildOneStoreBasket({
  store: m2Store,
  products: m2Products,
  plan: m2InitialPlan,
  activeDays: ['Di'],
  recipes: m2Recipes,
})
const lineId = basket.lines.find((line) => line.status === 'matched')?.id
assert.ok(lineId)
const legacy = serializeShoppingListProgress(basket, [lineId])
const cleanV2 = serializeShoppingProgressV2(basket, [])
const checkedV2 = serializeShoppingProgressV2(basket, [lineId])
assert.ok(legacy)
assert.ok(cleanV2)
assert.ok(checkedV2)

function memoryPort(initialV2 = null) {
  const state = new Map([[v1Key, legacy]])
  if (initialV2 !== null) state.set(v2Key, initialV2)
  const reads = []
  const writes = []
  return {
    state,
    reads,
    writes,
    getItem(key) {
      reads.push(key)
      return state.get(key) ?? null
    },
    setItem(key, value) {
      writes.push({ key, value })
      state.set(key, value)
    },
  }
}

test('Product #1056: present v2 never invokes an option getter with destructive side effects', () => {
  const port = memoryPort(checkedV2)
  let optionReads = 0
  const controller = openShoppingProgressStorageV2(basket, port, {
    get allowLegacyUpgrade() {
      optionReads++
      port.state.set(v2Key, '{"schemaVersion":3}')
      throw new Error('not needed for existing v2')
    },
  })
  assert.equal(optionReads, 0)
  assert.deepEqual(port.reads, [v2Key])
  assert.deepEqual(controller.snapshot().completedLineIds, [lineId])
  assert.equal(controller.storageFormatStatus(), 'ready')
  assert.equal(port.state.get(v2Key), checkedV2)
  assert.deepEqual(port.writes, [])
})

test('Product #1056: consent getter interleaved future schema cannot be overwritten by legacy upgrade', () => {
  const port = memoryPort()
  const futureBytes = '{"schemaVersion":3,"opaque":{"keep":"byte for byte"}}'
  const controller = openShoppingProgressStorageV2(basket, port, {
    get allowLegacyUpgrade() {
      // Simulate a newer tab saving *after* the initial missing-v2 read.
      port.state.set(v2Key, futureBytes)
      return true
    },
  })
  assert.deepEqual(controller.snapshot().completedLineIds, [lineId])
  assert.equal(controller.snapshot().upgradedFromLegacy, true)
  assert.deepEqual(port.reads, [v2Key, v1Key])
  assert.equal(controller.persist(), false, 'optimistic re-read must reject intervening v2 writes')
  assert.equal(controller.reloadSaved(), null, 'unknown future schema is not recoverable in v2')
  assert.equal(port.state.get(v2Key), futureBytes)
  assert.deepEqual(port.writes, [])
})

test('Product #1056: concurrent valid v2 outranks in-memory legacy after explicit read-only recovery', () => {
  const port = memoryPort()
  const controller = openShoppingProgressStorageV2(basket, port, {
    get allowLegacyUpgrade() {
      port.state.set(v2Key, cleanV2)
      return true
    },
  })
  assert.equal(controller.snapshot().upgradedFromLegacy, true)
  assert.deepEqual(controller.snapshot().completedLineIds, [lineId])
  assert.equal(controller.persist(), false)
  assert.deepEqual(port.writes, [])
  const recovered = controller.reloadSaved()
  assert.ok(recovered)
  assert.equal(recovered.upgradedFromLegacy, false)
  assert.deepEqual(recovered.completedLineIds, [])
  assert.equal(port.state.get(v2Key), cleanV2)
  controller.toggle(lineId)
  assert.equal(controller.persist(), true)
  assert.deepEqual(port.writes, [{ key: v2Key, value: checkedV2 }])
  assert.equal(port.state.get(v1Key), legacy, 'legacy record is never destroyed')
})

test('Product #1056: a throwing consent getter after an external write fails closed', () => {
  const port = memoryPort()
  const futureBytes = '{"schemaVersion":3,"demandIdentity":"foreign"}'
  const controller = openShoppingProgressStorageV2(basket, port, {
    get allowLegacyUpgrade() {
      port.state.set(v2Key, futureBytes)
      throw new Error('unavailable option')
    },
  })
  assert.equal(controller.storageFormatStatus(), 'unavailable')
  assert.deepEqual(controller.snapshot().completedLineIds, [])
  assert.deepEqual(port.reads, [v2Key])
  controller.toggle(lineId)
  assert.equal(controller.persist(), false)
  assert.equal(port.state.get(v2Key), futureBytes)
  assert.deepEqual(port.writes, [])
})

test('Product #1056: throwing legacy read after granted consent never initializes a writable snapshot', () => {
  const port = memoryPort()
  const originalRead = port.getItem
  port.getItem = function (key) {
    if (key === v1Key) {
      this.reads.push(key)
      throw new Error('private storage')
    }
    return originalRead.call(this, key)
  }
  const controller = openShoppingProgressStorageV2(basket, port, { allowLegacyUpgrade: true })
  assert.deepEqual(port.reads, [v2Key, v1Key])
  assert.equal(controller.storageFormatStatus(), 'unavailable')
  assert.deepEqual(controller.snapshot().completedLineIds, [])
  controller.toggle(lineId)
  assert.equal(controller.persist(), false)
  assert.deepEqual(port.writes, [])
})

test('Product #1056: null storage never reads irrelevant hostile migration options', () => {
  let reads = 0
  const controller = openShoppingProgressStorageV2(basket, null, {
    get allowLegacyUpgrade() {
      reads++
      throw new Error('should not be read')
    },
  })
  assert.equal(reads, 0)
  assert.equal(controller.storageFormatStatus(), 'unavailable')
  assert.equal(controller.canRetryStorageRead(), false)
  assert.equal(controller.persist(), false)
})

test('Product #1056: truthy non-boolean consent cannot authorize a legacy read', async (t) => {
  for (const value of [1, 'true', new Boolean(true), [], {}]) {
    await t.test('consent ' + Object.prototype.toString.call(value), () => {
      const port = memoryPort()
      const controller = openShoppingProgressStorageV2(basket, port, { allowLegacyUpgrade: value })
      assert.deepEqual(port.reads, [v2Key])
      assert.deepEqual(controller.snapshot().completedLineIds, [])
      assert.equal(controller.snapshot().upgradedFromLegacy, false)
      assert.deepEqual(port.writes, [])
    })
  }
})

test('Product #1603: existing unknown v2 suppresses both consent evaluation and accidental v1 restore', () => {
  const futureBytes = '{"schemaVersion":3,"future":"retain exactly"}'
  const port = memoryPort(futureBytes)
  let reads = 0
  const controller = openShoppingProgressStorageV2(basket, port, {
    get allowLegacyUpgrade() {
      reads++
      return true
    },
  })
  assert.equal(reads, 0)
  assert.deepEqual(port.reads, [v2Key])
  assert.deepEqual(controller.snapshot().completedLineIds, [])
  assert.equal(controller.storageFormatStatus(), 'unknown-record')
  controller.toggle(lineId)
  assert.equal(controller.persist(), false)
  assert.equal(port.state.get(v2Key), futureBytes)
  assert.deepEqual(port.writes, [])
})
