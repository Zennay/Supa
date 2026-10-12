import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'

function basket() {
  return buildOneStoreBasket({
    store: { ...m2Store }, plan: m2InitialPlan,
    recipes: m2Recipes, products: m2Products,
    activeDays: ['Di'],
  })
}

function fixture(raw) {
  const saved = new Map([[shoppingListProgressV2StorageKey, raw]])
  const writes = []
  return {
    saved, writes,
    storage: {
      getItem(key) { return saved.get(key) ?? null },
      setItem(key, value) { writes.push([key, value]); saved.set(key, value) },
    },
  }
}

test('QA #1603: Unicode-escaped duplicate root keys cannot silently replace protected v2 bytes', () => {
  const current = basket()
  const known = serializeShoppingProgressV2(current, [current.lines[0].id])
  assert.equal(typeof known, 'string')

  // JSON.parse treats each escaped spelling as an identical property name;
  // a last-key-wins parser alone would silently drop an earlier root value.
  const ambiguous = [
    known.replace('"schemaVersion":2,', '"schemaVersion":2,"\\u0073chemaVersion":2,'),
    known.replace('"doneLineIds":', '"doneLineIds":[],"\\u0064oneLineIds":'),
    known.replace('"demandIdentity":', '"demandIdentity":"other","\\u0064emandIdentity":'),
  ]
  for (const raw of ambiguous) {
    assert.equal(JSON.parse(raw).schemaVersion, 2)
    const port = fixture(raw)
    const controller = openShoppingProgressStorageV2(current, port.storage)
    assert.equal(controller.storageFormatStatus(), 'unknown-record', raw.slice(0, 90))
    controller.toggle(current.lines[0].id)
    assert.equal(controller.persist(), false)
    assert.equal(controller.reloadSaved({ requireSameDemand: true }), null)
    assert.deepEqual(port.writes, [])
    assert.equal(port.saved.get(shoppingListProgressV2StorageKey), raw)
  }
})

test('QA #1603: legitimate nested metadata and quoted JSON-like text are not root duplicates', () => {
  const current = basket()
  const saved = serializeShoppingProgressV2(current, [current.lines[0].id])
  assert.equal(typeof saved, 'string')
  const raw = JSON.stringify({
    ...JSON.parse(saved),
    note: 'quoted payload: {"schemaVersion": 3, "doneLineIds": []}',
    metadata: { schemaVersion: 7, doneLineIds: ['inner-only'], nested: { demandIdentity: 'inner' } },
    futureDescription: 'remember literal { } [ ] and escaped \\u0073chemaVersion',
  })
  const port = fixture(raw)
  const controller = openShoppingProgressStorageV2(current, port.storage)
  assert.equal(controller.storageFormatStatus(), 'ready')
  assert.deepEqual(controller.snapshot().completedLineIds, [current.lines[0].id])
  assert.deepEqual(port.writes, [], 'opening valid optional metadata is read-only')
  assert.equal(port.saved.get(shoppingListProgressV2StorageKey), raw)

  controller.toggle(current.lines[0].id)
  assert.equal(controller.persist(), true)
  assert.equal(port.writes.length, 1)
  assert.deepEqual(JSON.parse(port.writes[0][1]).doneLineIds, [])
})
