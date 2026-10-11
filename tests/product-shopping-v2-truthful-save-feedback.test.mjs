import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

const basket = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: ['Di'],
})
const item = basket.lines.find((line) => line.status === 'matched')?.id
assert.ok(item)

test('unknown or unreadable storage is a protected warning, not a competing generic stale-tab warning', () => {
  const unknown = JSON.stringify({ schemaVersion: 3, futureOnly: 'synthetic' })
  const disks = [
    {
      getItem() { return unknown },
      setItem() { throw new Error('future version must not be overwritten') },
    },
    null,
    {
      getItem() { throw new Error('synthetic denied read') },
      setItem() { throw new Error('denied write') },
    },
  ]
  const expected = ['unknown-record', 'unavailable', 'unavailable']
  for (let i = 0; i < disks.length; i++) {
    const controller = openShoppingProgressStorageV2(basket, disks[i])
    controller.toggle(item)
    assert.equal(controller.persist(), false)
    assert.equal(controller.storageFormatStatus(), expected[i])
    assert.deepEqual(controller.snapshot().completedLineIds, [item],
      'in-memory progress remains available')
  }
})

test('a stale but otherwise supported v2 snapshot still deserves the generic save-conflict action', () => {
  const values = new Map()
  const disk = {
    getItem(keyName) { return values.get(keyName) ?? null },
    setItem(keyName, value) { values.set(keyName, value) },
  }
  const controller = openShoppingProgressStorageV2(basket, disk)
  controller.toggle(item)
  const otherTab = serializeShoppingProgressV2(basket, [])
  assert.ok(otherTab)
  values.set(key, otherTab)
  assert.equal(controller.persist(), false)
  assert.equal(controller.storageFormatStatus(), 'ready')
  assert.equal(values.get(key), otherTab)
})

test('staged UI limits generic failed-save message to readable v2 conflicts in all three save paths', () => {
  const source = readFileSync(
    new URL('../src/features/shopping-list/ShoppingListViewV2.tsx', import.meta.url), 'utf8',
  )
  assert.match(source,
    /setSaveFailed\(!controller\.persist\(\) && controller\.storageFormatStatus\(\) === 'ready'\)/,
    'automatic physical-demand transitions cannot mislabel a protected unknown record as stale')
  assert.equal(
    [...source.matchAll(/setSaveFailed\(next\.serialized !== null && !controller\.persist\(\) && controller\.storageFormatStatus\(\) === 'ready'\)/g)].length,
    2,
    'manual tick and clear should use the same accurate feedback precedence',
  )
  assert.match(source, /\{unknownStoredRecord && \(/)
  assert.match(source, /\{unavailableStorage && \(/)
  assert.match(source, /\{saveFailed && \(/)
})
