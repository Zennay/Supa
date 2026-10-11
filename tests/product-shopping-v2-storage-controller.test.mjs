import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'
import {
  openShoppingProgressStorageV2,
} from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingListProgress,
  shoppingListProgressStorageKey,
} from '../src/features/shopping-list/shoppingListProgress.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'

function basket(products = m2Products) {
  return buildOneStoreBasket({
    store: m2Store,
    products,
    activeDays: ['Di'],
    plan: m2InitialPlan,
    recipes: m2Recipes,
  })
}

function storage(initial = {}) {
  const data = new Map(Object.entries(initial))
  const reads = []
  const writes = []
  return {
    data, reads, writes,
    getItem(key) {
      reads.push(key)
      return data.get(key) ?? null
    },
    setItem(key, value) {
      writes.push([key, value])
      data.set(key, value)
    },
  }
}

test('opening a controller reads v2 without writing during initialization', () => {
  const disk = storage()
  const controller = openShoppingProgressStorageV2(basket(), disk)
  assert.deepEqual(disk.reads, [shoppingListProgressV2StorageKey])
  assert.deepEqual(disk.writes, [])
  assert.deepEqual(controller.snapshot().completedLineIds, [])
  assert.equal(controller.snapshot().upgradedFromLegacy, false)
  assert.equal(controller.persist(), true)
  assert.deepEqual(disk.writes.map(([key]) => key), [shoppingListProgressV2StorageKey])
})

test('price-only repricing keeps in-memory and persisted ticks without preserving stale money', () => {
  const initial = basket()
  const line = initial.lines.find((row) => row.status === 'matched')
  assert.ok(line)
  const disk = storage()
  const controller = openShoppingProgressStorageV2(initial, disk)
  assert.deepEqual(controller.toggle(line.id).completedLineIds, [line.id])
  assert.equal(controller.persist(), true)
  const next = basket(m2Products.map((product) => product.id === line.productId
    ? { ...product, priceCents: product.priceCents + 1 }
    : product))
  assert.notEqual(initial.totalCents, next.totalCents)
  assert.deepEqual(controller.rebase(next).completedLineIds, [line.id])
  assert.equal(controller.persist(), true)
  assert.deepEqual(
    openShoppingProgressStorageV2(next, disk).snapshot().completedLineIds,
    [line.id],
  )
})

test('existing or malformed v2 snapshots never trigger hidden v1 fallback', () => {
  const initial = basket()
  const checked = initial.lines[0].id
  const rawV1 = serializeShoppingListProgress(initial, [checked])
  const existing = storage({
    [shoppingListProgressV2StorageKey]: '{malformed',
    [shoppingListProgressStorageKey]: rawV1,
  })
  const blocked = openShoppingProgressStorageV2(initial, existing, {
    allowLegacyUpgrade: true,
  })
  assert.deepEqual(existing.reads, [shoppingListProgressV2StorageKey])
  assert.deepEqual(blocked.snapshot().completedLineIds, [])
  assert.equal(blocked.snapshot().upgradedFromLegacy, false)
})

test('legacy v1 upgrades only with opt-in, exact basket key and absent v2', () => {
  const initial = basket()
  const checked = initial.lines[0].id
  const rawV1 = serializeShoppingListProgress(initial, [checked])
  const noConsent = storage({ [shoppingListProgressStorageKey]: rawV1 })
  assert.deepEqual(
    openShoppingProgressStorageV2(initial, noConsent).snapshot().completedLineIds,
    [],
  )
  assert.deepEqual(noConsent.reads, [shoppingListProgressV2StorageKey])

  const consent = storage({ [shoppingListProgressStorageKey]: rawV1 })
  const controller = openShoppingProgressStorageV2(initial, consent, {
    allowLegacyUpgrade: true,
  })
  assert.deepEqual(controller.snapshot().completedLineIds, [checked])
  assert.equal(controller.snapshot().upgradedFromLegacy, true)
  assert.deepEqual(consent.writes, [], 'upgrade must never write from initial render')
  assert.equal(controller.persist(), true)
  assert.ok(consent.data.has(shoppingListProgressV2StorageKey))
  assert.equal(consent.data.get(shoppingListProgressStorageKey), rawV1)

  const changed = structuredClone(initial)
  changed.store.id = 'other-store'
  const stale = storage({ [shoppingListProgressStorageKey]: rawV1 })
  assert.deepEqual(
    openShoppingProgressStorageV2(changed, stale, {
      allowLegacyUpgrade: true,
    }).snapshot().completedLineIds,
    [],
  )
})

test('blocked reads fail closed without touching v1 or writing persistence', () => {
  let reads = 0
  let writes = 0
  const blocked = {
    getItem() {
      reads++
      throw new Error('Storage is disabled by browser policy')
    },
    setItem() { writes++ },
  }
  const initial = basket()
  const controller = openShoppingProgressStorageV2(initial, blocked, {
    allowLegacyUpgrade: true,
  })
  assert.equal(reads, 1)
  const id = initial.lines[0].id
  assert.deepEqual(controller.toggle(id).completedLineIds, [id])
  assert.equal(controller.persist(), false)
  assert.equal(writes, 0)
})

test('blocked writes do not clear in-memory checked state or throw', () => {
  const initial = basket()
  const disk = {
    getItem() { return null },
    setItem() { throw new Error('QuotaExceededError') },
  }
  const controller = openShoppingProgressStorageV2(initial, disk)
  const id = initial.lines[0].id
  controller.toggle(id)
  assert.equal(controller.persist(), false)
  assert.deepEqual(controller.snapshot().completedLineIds, [id])
})

test('caller mutation of returned checkmarks cannot poison session state', () => {
  const initial = basket()
  const controller = openShoppingProgressStorageV2(initial, storage())
  const first = initial.lines[0].id
  const returned = controller.toggle(first)
  returned.completedLineIds.push('synthetic-untrusted-id')
  assert.deepEqual(controller.snapshot().completedLineIds, [first])
  assert.equal(controller.persist(), true)
})

test('in-place physical changes invalidate controller ticks before later toggles', () => {
  const current = basket()
  const disk = storage()
  const controller = openShoppingProgressStorageV2(current, disk)
  const matched = current.lines.find((line) => line.status === 'matched')
  assert.ok(matched)
  controller.toggle(matched.id)
  const changedInPlace = current
  matched.pack.count += 1
  const changed = controller.rebase(changedInPlace)
  assert.deepEqual(changed.completedLineIds, [])
  assert.equal(controller.persist(), true)
  assert.deepEqual(
    openShoppingProgressStorageV2(changedInPlace, disk).snapshot().completedLineIds,
    [],
  )
})

test('invalid baskets cannot be persisted even if a valid prior session had checks', () => {
  const initial = basket()
  const disk = storage()
  const controller = openShoppingProgressStorageV2(initial, disk)
  controller.toggle(initial.lines[0].id)
  const broken = { ...initial, store: null }
  const result = controller.rebase(broken)
  assert.equal(result.demandIdentity, null)
  assert.equal(result.serialized, null)
  assert.deepEqual(result.completedLineIds, [])
  assert.equal(controller.persist(), false)
  assert.deepEqual(disk.writes, [])
})
