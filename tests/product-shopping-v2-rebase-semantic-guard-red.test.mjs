import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Synthetic product boundary: a future record may initially belong to an
// unrelated physical basket, then match after a local rebase.
const original = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: ['Di'],
})
const line = original.lines.find((entry) => entry.status === 'matched')?.id
assert.ok(line)
const canonical = serializeShoppingProgressV2(original, [line])
assert.ok(canonical)
const alternate = {
  ...original,
  store: { ...original.store, id: 'synthetic-alternate-store' },
}

function port(raw) {
  let writes = 0
  const entries = new Map([[key, raw]])
  return {
    entries,
    get writes() { return writes },
    getItem(k) { return entries.get(k) ?? null },
    setItem(k, v) { writes++; entries.set(k, v) },
  }
}

test('Product #1603: rebase into identity of corrupt durable data must not overwrite unsupported line ID', () => {
  const raw = JSON.stringify({
    ...JSON.parse(canonical),
    doneLineIds: [line, 'synthetic-unknown-line-from-future'],
  })
  const disk = port(raw)
  const controller = openShoppingProgressStorageV2(alternate, disk)
  assert.equal(controller.storageFormatStatus(), 'ready', 'foreign envelope is initially recognized')
  controller.rebase(original)
  assert.equal(controller.storageFormatStatus(), 'unknown-record', 'now same-demand corrupt record is protected')
  controller.toggle(line)
  assert.equal(controller.persist(), false)
  assert.equal(disk.entries.get(key), raw)
  assert.equal(disk.writes, 0)
})

test('Product #1603: valid foreign durable record remains saveable through explicit physical rebase', () => {
  const disk = port(canonical)
  const controller = openShoppingProgressStorageV2(alternate, disk)
  controller.rebase(original)
  assert.equal(controller.storageFormatStatus(), 'ready')
  controller.toggle(line)
  assert.equal(controller.persist(), true)
  assert.equal(disk.writes, 1)
  assert.deepEqual(JSON.parse(disk.entries.get(key)).doneLineIds, [line])
})
