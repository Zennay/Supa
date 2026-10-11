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
  store: m2Store,
  products: m2Products,
  recipes: m2Recipes,
  plan: m2InitialPlan,
  activeDays: ['Di'],
})
const picked = basket.lines.find((line) => line.status === 'matched')?.id
assert.ok(picked)

function disk(initial) {
  const data = new Map()
  if (initial !== null) data.set(v2Key, initial)
  let writes = 0
  return {
    data,
    get writes() { return writes },
    getItem(key) { return data.get(key) ?? null },
    setItem(key, value) { writes++; data.set(key, value) },
  }
}

test('product: unknown persisted version announces protected read-only state before clicks', () => {
  for (const value of [
    JSON.stringify({ schemaVersion: 3, doneLineIds: [picked] }),
    '{ not valid json',
    JSON.stringify({ schemaVersion: 2, demandIdentity: '', doneLineIds: [] }),
  ]) {
    const storage = disk(value)
    const controller = openShoppingProgressStorageV2(basket, storage)
    assert.equal(controller.storageFormatStatus(), 'unknown-record')
    controller.toggle(picked)
    assert.equal(controller.persist(), false)
    assert.equal(controller.storageFormatStatus(), 'unknown-record')
    assert.equal(storage.writes, 0)
    assert.equal(storage.data.get(v2Key), value)
  }
})

test('product: recognized same-demand v2, empty key and denied storage have distinct states', () => {
  const valid = serializeShoppingProgressV2(basket, [picked])
  assert.ok(valid)
  assert.equal(openShoppingProgressStorageV2(basket, disk(valid)).storageFormatStatus(), 'ready')
  assert.equal(openShoppingProgressStorageV2(basket, disk(null)).storageFormatStatus(), 'ready')
  assert.equal(openShoppingProgressStorageV2(basket, null).storageFormatStatus(), 'unavailable')
  assert.equal(openShoppingProgressStorageV2(basket, {
    getItem() { throw Error('synthetic private-mode denial') },
    setItem() { throw Error('synthetic private-mode denial') },
  }).storageFormatStatus(), 'unavailable')
})

test('product: successful explicit recovery dismisses unknown-version protection without writing', () => {
  const storage = disk(JSON.stringify({ schemaVersion: 5, futureValue: 'synthetic' }))
  const controller = openShoppingProgressStorageV2(basket, storage)
  assert.equal(controller.storageFormatStatus(), 'unknown-record')
  const known = serializeShoppingProgressV2(basket, [picked])
  assert.ok(known)
  storage.data.set(v2Key, known)
  assert.deepEqual(controller.reloadSaved()?.completedLineIds, [picked])
  assert.equal(controller.storageFormatStatus(), 'ready')
  assert.equal(storage.writes, 0, 'recovery reads without writing')
  controller.toggle(picked)
  assert.equal(controller.persist(), true)
  assert.equal(storage.writes, 1)
})

test('product: real shopping-v2 screen explains protected storage without enabling silent overwrite', () => {
  const source = readFileSync(
    new URL('../src/features/shopping-list/ShoppingListViewV2.tsx', import.meta.url),
    'utf8',
  )
  assert.match(source, /setUnknownStoredRecord\(controller\.storageFormatStatus\(\) === 'unknown-record'\)/)
  assert.match(source, /useState\(false\).*Set after mount|Set after mount to keep SSR markup stable/s)
  assert.match(source, /data-storage-state="unknown-record"/)
  assert.match(source, /role="status" aria-live="polite" data-storage-state="unknown-record"/)
  assert.match(source, /Opgeslagen boodschappenlijst beschermd/)
  assert.match(source, /SUPA overschrijft de bestaande gegevens niet/)
  assert.match(source, /onClick=\{reloadSaved\}/, 'the user retains an explicit read-only recovery path')
})
