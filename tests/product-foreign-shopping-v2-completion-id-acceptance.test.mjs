import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2, shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Independent postrepair acceptance for #1603. All stores and groceries are
// controlled M2 fixtures; no real person, receipt, retailer or savings proof.
const local = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: m2DefaultActiveDays,
})
assert.equal(local.lines.length, 11)
const matched = local.lines.filter(line => line.status === 'matched')
assert.ok(matched.length >= 2)
const [first, second] = matched
const foreign = { ...local, store: { ...local.store, id: 'fixture-other-shop' } }

function store(initial) {
  const bytes = new Map([[key, initial]])
  const writes = []
  const reads = []
  return {
    bytes, writes, reads,
    getItem(k) {
      reads.push(k)
      assert.equal(k, key, 'legacy v1 must stay untouched')
      return bytes.get(k) ?? null
    },
    setItem(k, value) {
      assert.equal(k, key)
      writes.push(value)
      bytes.set(k, value)
    },
  }
}

function rawWithIds(basket, ids) {
  const valid = serializeShoppingProgressV2(basket, [])
  assert.ok(valid)
  return JSON.stringify({ ...JSON.parse(valid), doneLineIds: ids })
}

test('acceptance #1603: foreign record with two actual member IDs can be deliberately replaced', () => {
  const existing = rawWithIds(foreign, [first.id, second.id])
  const disk = store(existing)
  const tab = openShoppingProgressStorageV2(local, disk)
  assert.equal(tab.storageFormatStatus(), 'ready')
  tab.toggle(first.id)
  assert.equal(tab.persist(), true)
  assert.deepEqual(JSON.parse(disk.bytes.get(key)).doneLineIds, [first.id])
  assert.equal(disk.writes.length, 1)
  assert.ok(disk.reads.every(k => k === key))
})

test('acceptance #1603: valid foreign identity cannot smuggle completed ID for absent foreign line', () => {
  const reducedForeign = { ...foreign, lines: foreign.lines.filter(line => line.id !== first.id) }
  assert.equal(reducedForeign.lines.length, 10)
  const malformed = rawWithIds(reducedForeign, [first.id])
  const disk = store(malformed)
  const tab = openShoppingProgressStorageV2(local, disk)
  assert.equal(tab.storageFormatStatus(), 'ready', 'unrelated foreign envelope is displayed until write validation')
  tab.toggle(first.id)
  assert.equal(tab.persist(), false)
  assert.equal(tab.storageFormatStatus(), 'unknown-record')
  assert.equal(tab.reloadSaved(), null)
  assert.equal(disk.bytes.get(key), malformed)
  assert.deepEqual(disk.writes, [], 'do not downgrade another task on fresh open')
})

test('acceptance #1603: unknown trailing foreign ID cannot be hidden among valid IDs', () => {
  const malformed = rawWithIds(foreign, [first.id, second.id, 'future-only-line'])
  const disk = store(malformed)
  const tab = openShoppingProgressStorageV2(local, disk)
  assert.equal(tab.storageFormatStatus(), 'ready', 'unrelated foreign envelope is displayed until write validation')
  tab.clear()
  assert.equal(tab.persist(), false)
  assert.equal(tab.storageFormatStatus(), 'unknown-record')
  tab.rebase({ ...local, lines: local.lines.map(line => ({ ...line })) })
  assert.equal(tab.persist(), false)
  assert.equal(disk.bytes.get(key), malformed)
  assert.deepEqual(disk.writes, [])
})

test('acceptance #1603: after rejecting corrupt foreign state, explicit same-demand recovery can succeed', () => {
  const malformed = rawWithIds(foreign, [first.id, 'unknown-extension'])
  const supportedLocal = serializeShoppingProgressV2(local, [second.id])
  assert.ok(supportedLocal)
  const disk = store(malformed)
  const tab = openShoppingProgressStorageV2(local, disk)
  tab.toggle(first.id)
  assert.equal(tab.persist(), false)
  assert.equal(tab.reloadSaved(), null)
  assert.deepEqual(tab.snapshot().completedLineIds, [first.id])
  assert.equal(disk.bytes.get(key), malformed)
  disk.bytes.set(key, supportedLocal) // External client deliberately restores the current physical task.
  assert.deepEqual(tab.reloadSaved()?.completedLineIds, [second.id])
  assert.equal(tab.storageFormatStatus(), 'ready')
  tab.toggle(first.id)
  assert.equal(tab.persist(), true)
  assert.deepEqual(JSON.parse(disk.bytes.get(key)).doneLineIds, [second.id, first.id])
  assert.equal(disk.writes.length, 1)
})
