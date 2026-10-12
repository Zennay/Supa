import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { shoppingListRowsV2 } from '../src/features/shopping-list/shoppingListRowsV2.ts'
import {
  shoppingListProgressV2StorageKey,
  restoreShoppingProgressV2,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { shoppingListProgressStorageKey } from '../src/features/shopping-list/shoppingListProgress.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'

// Physical shopping round -> Dutch copy -> durable checks -> changed basket.
// Everything is a controlled M2 fixture; no real shop prices or participant.
function basket() {
  return buildOneStoreBasket({
    store: m2Store, products: m2Products, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays,
  })
}

function memoryPort(initial = []) {
  const records = new Map(initial)
  const calls = { reads: [], writes: [] }
  const port = {
    getItem(key) {
      calls.reads.push(key)
      return records.get(key) ?? null
    },
    setItem(key, value) {
      calls.writes.push([key, value])
      records.set(key, value)
    },
  }
  return { records, calls, port }
}

function pricedRefresh(original) {
  const next = structuredClone(original)
  const priced = next.lines.find(line => line.status === 'matched')
  assert.ok(priced)
  priced.pricePerPackCents += 1
  priced.lineTotalCents += priced.packs
  next.totalCents += priced.packs
  return next
}

test('product shopping v2: saved M2 checks survive a price refresh with Dutch rows and no implicit writes', () => {
  const original = basket()
  const frozen = structuredClone(original)
  const checkedId = original.lines[0].id
  const storage = memoryPort([[shoppingListProgressStorageKey, 'legacy-do-not-touch']])
  const controller = openShoppingProgressStorageV2(original, storage.port)
  assert.deepEqual(storage.calls.writes, [], 'Opening a round only reads')
  assert.equal(controller.storageFormatStatus(), 'ready')
  assert.equal(controller.snapshot().completedLineIds.length, 0)

  controller.toggle(checkedId)
  assert.equal(controller.persist(), true)
  const written = storage.records.get(shoppingListProgressV2StorageKey)
  assert.equal(typeof written, 'string')
  assert.deepEqual(restoreShoppingProgressV2(original, written), [checkedId])
  assert.equal(storage.records.get(shoppingListProgressStorageKey), 'legacy-do-not-touch')
  assert.deepEqual(storage.calls.writes.map(([key]) => key), [shoppingListProgressV2StorageKey])

  const later = pricedRefresh(original)
  assert.equal(shoppingListDemandIdentity(later), shoppingListDemandIdentity(original))
  const session = controller.rebase(later)
  assert.deepEqual(session.completedLineIds, [checkedId])
  const rows = shoppingListRowsV2(later, session)
  assert.equal(rows.length, later.lines.length)
  assert.equal(rows.find(line => line.id === checkedId)?.checked, true)
  assert.ok(rows.every(line => !/\\b(?:unknown|piece)\\b/.test(line.quantity)))
  assert.deepEqual(storage.calls.writes.map(([key]) => key), [shoppingListProgressV2StorageKey])
  assert.equal(storage.records.get(shoppingListProgressV2StorageKey), written)
  assert.deepEqual(original, frozen)
})

test('product shopping v2: an intentional new physical basket cannot inherit the previous saved checks', () => {
  const first = basket()
  const firstId = first.lines[0].id
  const next = structuredClone(first)
  next.lines[0].requirement.amount += 1
  assert.notEqual(shoppingListDemandIdentity(first), shoppingListDemandIdentity(next))
  const firstUnchanged = structuredClone(first)
  const nextUnchanged = structuredClone(next)
  const storage = memoryPort()
  const oldTab = openShoppingProgressStorageV2(first, storage.port)
  oldTab.toggle(firstId)
  assert.equal(oldTab.persist(), true)
  const oldBytes = storage.records.get(shoppingListProgressV2StorageKey)
  const newTab = openShoppingProgressStorageV2(first, storage.port)
  const newSession = newTab.rebase(next)
  assert.deepEqual(newSession.completedLineIds, [])
  assert.ok(shoppingListRowsV2(next, newSession).every(row => !row.checked))
  assert.equal(storage.records.get(shoppingListProgressV2StorageKey), oldBytes, 'Rebase cannot write')

  // An actual user switching to the new physical task can save a new record.
  assert.equal(newTab.persist(), true)
  const newBytes = storage.records.get(shoppingListProgressV2StorageKey)
  assert.notEqual(newBytes, oldBytes)
  assert.deepEqual(restoreShoppingProgressV2(next, newBytes), [])
  assert.deepEqual(restoreShoppingProgressV2(first, newBytes), [])

  // Meanwhile, a stale first tab must never roll back the new task.
  oldTab.toggle(firstId)
  assert.equal(oldTab.persist(), false)
  assert.equal(oldTab.reloadSaved(), null)
  assert.equal(storage.records.get(shoppingListProgressV2StorageKey), newBytes)
  assert.deepEqual(first, firstUnchanged)
  assert.deepEqual(next, nextUnchanged)
})

test('product shopping v2: a future storage schema is not rewritten by checkbox, clear or basket rebase', () => {
  const original = basket()
  const foreign = structuredClone(original)
  foreign.lines[0].requirement.amount += 1
  const foreignRaw = JSON.stringify({
    schemaVersion: 3,
    demandIdentity: shoppingListDemandIdentity(foreign),
    doneLineIds: [foreign.lines[0].id],
    revision: 'future-opaque-fields',
  })
  const storage = memoryPort([[shoppingListProgressV2StorageKey, foreignRaw]])
  const controller = openShoppingProgressStorageV2(original, storage.port)
  assert.equal(controller.storageFormatStatus(), 'unknown-record')
  assert.deepEqual(storage.calls.writes, [])
  controller.toggle(original.lines[0].id)
  assert.equal(controller.persist(), false)
  controller.clear()
  assert.equal(controller.persist(), false)
  controller.rebase(foreign)
  assert.equal(controller.persist(), false)
  assert.equal(controller.reloadSaved({ requireSameDemand: true }), null)
  assert.equal(storage.records.get(shoppingListProgressV2StorageKey), foreignRaw)
  assert.deepEqual(storage.calls.writes, [])
})

test('product shopping v2: an unresolved amount is Dutch-only presentation, not inferred money or saved claim', () => {
  const original = basket()
  const line = original.lines.find(item => item.status === 'matched')
  assert.ok(line)
  line.status = 'unresolved'
  line.requirement = { amount: null, unit: 'unknown' }
  const previous = structuredClone(original)
  const storage = memoryPort()
  const controller = openShoppingProgressStorageV2(original, storage.port)
  const row = shoppingListRowsV2(original, controller.snapshot()).find(item => item.id === line.id)
  assert.ok(row)
  assert.equal(row.quantity, '? onbekend · handmatig kiezen')
  assert.equal(row.unresolved, true)
  assert.doesNotMatch(row.quantity, /€|EUR|bespaar/i)
  assert.deepEqual(storage.calls.writes, [])
  assert.deepEqual(original, previous)
})
