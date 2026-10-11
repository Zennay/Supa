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

function disk(raw) {
  const values = new Map([[v2Key, raw]])
  let writes = 0
  return {
    values,
    get writes() { return writes },
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { writes++; values.set(key, value) },
  }
}

test('protected checklist can be rechecked after another client installs supported same-demand v2, without a write', () => {
  const future = JSON.stringify({ schemaVersion: 3, contents: 'invented future state' })
  const storage = disk(future)
  const controller = openShoppingProgressStorageV2(basket, storage)
  assert.equal(controller.storageFormatStatus(), 'unknown-record')
  assert.equal(controller.reloadSaved(), null)
  assert.equal(storage.writes, 0)
  assert.equal(storage.values.get(v2Key), future)

  const supported = serializeShoppingProgressV2(basket, [item])
  assert.ok(supported)
  storage.values.set(v2Key, supported) // simulate an external, explicit change
  assert.deepEqual(controller.reloadSaved()?.completedLineIds, [item])
  assert.equal(controller.storageFormatStatus(), 'ready')
  assert.equal(storage.writes, 0, 'recheck may only read; it cannot migrate or overwrite')
  assert.equal(storage.values.get(v2Key), supported)
})

test('rechecking a still-unknown record preserves its raw bytes and temporary checks', () => {
  for (const raw of [
    '{malformed',
    JSON.stringify({ schemaVersion: 9, meta: 'synthetic-only' }),
    JSON.stringify({ schemaVersion: 2, demandIdentity: '', doneLineIds: [] }),
  ]) {
    const storage = disk(raw)
    const controller = openShoppingProgressStorageV2(basket, storage)
    controller.toggle(item)
    assert.equal(controller.reloadSaved(), null)
    assert.equal(controller.storageFormatStatus(), 'unknown-record')
    assert.deepEqual(controller.snapshot().completedLineIds, [item])
    assert.equal(controller.persist(), false)
    assert.equal(storage.values.get(v2Key), raw)
    assert.equal(storage.writes, 0)
  }
})

test('staged real view offers a user-invoked read-only recheck before any tick, only for protected unknown storage', () => {
  const source = readFileSync(
    new URL('../src/features/shopping-list/ShoppingListViewV2.tsx', import.meta.url), 'utf8',
  )
  const protectedBlock = source.match(
    /\{unknownStoredRecord && \([\s\S]*?data-storage-state="unknown-record"[\s\S]*?\n\s*\)\}/,
  )?.[0]
  assert.ok(protectedBlock, 'the actual view must preserve a distinct protected-record advisory')
  assert.match(protectedBlock, /onClick=\{reloadSaved\}/,
    'the recheck must be available before saveFailed becomes true')
  assert.match(protectedBlock, /Opgeslagen versie opnieuw controleren/)
  assert.match(protectedBlock, /SUPA overschrijft de bestaande gegevens niet/)
  const unavailableBlock = source.match(
    /\{unavailableStorage && \([\s\S]*?data-storage-state="unavailable"[\s\S]*?\n\s*\)\}/,
  )?.[0]
  assert.ok(unavailableBlock)
  assert.doesNotMatch(unavailableBlock, /Opgeslagen versie opnieuw controleren/,
    'a null/unavailable port cannot be reopened by this controller')
  assert.match(source, /De opgeslagen versie is nog niet leesbaar/,
    'failed read-only recheck should not imply that another tab necessarily edited the basket')
})
