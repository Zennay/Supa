import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Independent, add-only postrepair acceptance for #1603: synthetic storage,
// no real retailer observations, browsers, or legacy-key migration.
const basket = buildOneStoreBasket({
  store: m2Store, products: m2Products, recipes: m2Recipes,
  plan: m2InitialPlan, activeDays: ['Di'],
})
const line = basket.lines.find((entry) => entry.status === 'matched')?.id
assert.ok(line, 'synthetic M2 fixture must contain one matched shopping line')
const valid = serializeShoppingProgressV2(basket, [line])
assert.ok(valid)

function storage(initial) {
  const entries = new Map(initial === null ? [] : [[key, initial]])
  let writes = 0
  return {
    entries,
    get writes() { return writes },
    getItem(k) { return entries.get(k) ?? null },
    setItem(k, v) { writes++; entries.set(k, v) },
  }
}

test('Product #1603: all unsupported same-demand completed IDs are read-only through local operations', () => {
  for (const ids of [
    [line, line],
    [line, 'synthetic-future-line'],
    [''],
  ]) {
    const raw = JSON.stringify({ ...JSON.parse(valid), doneLineIds: ids })
    const disk = storage(raw)
    const controller = openShoppingProgressStorageV2(basket, disk)
    assert.equal(controller.storageFormatStatus(), 'unknown-record', JSON.stringify(ids))
    controller.toggle(line)
    assert.equal(controller.persist(), false)
    controller.clear()
    assert.equal(controller.persist(), false)
    controller.rebase(basket)
    assert.equal(controller.persist(), false)
    assert.equal(disk.entries.get(key), raw, 'unsupported bytes must remain intact')
    assert.equal(disk.writes, 0)
  }
})

test('Product #1603: strict recovery never adopts corrupt same-demand external revision', () => {
  const disk = storage(valid)
  const controller = openShoppingProgressStorageV2(basket, disk)
  controller.toggle(line)
  const tickBefore = controller.snapshot().completedLineIds
  const corrupt = JSON.stringify({ ...JSON.parse(valid), doneLineIds: [line, line] })
  disk.entries.set(key, corrupt)
  assert.equal(controller.reloadSaved({ requireSameDemand: true }), null)
  assert.deepEqual(controller.snapshot().completedLineIds, tickBefore)
  assert.equal(controller.persist(), false)
  assert.equal(disk.entries.get(key), corrupt)
  assert.equal(disk.writes, 0)

  // Another compatible client fixes storage; a deliberate read-only retry
  // may then adopt that same physical basket without writing on reload.
  disk.entries.set(key, valid)
  assert.ok(controller.reloadSaved({ requireSameDemand: true }))
  assert.deepEqual(controller.snapshot().completedLineIds, [line])
  assert.equal(disk.writes, 0)
  controller.toggle(line)
  assert.equal(controller.persist(), true)
  assert.deepEqual(JSON.parse(disk.entries.get(key)).doneLineIds, [])
  assert.equal(disk.writes, 1)
})

test('Product #1603: fresh deliberate physical basket switch still replaces a recognized foreign v2', () => {
  const foreignBasket = {
    ...basket,
    store: { ...basket.store, id: 'synthetic-other-physical-store' },
  }
  const foreign = serializeShoppingProgressV2(foreignBasket, [line])
  assert.ok(foreign)
  const disk = storage(foreign)
  const controller = openShoppingProgressStorageV2(basket, disk)
  assert.equal(controller.storageFormatStatus(), 'ready')
  assert.deepEqual(controller.snapshot().completedLineIds, [])
  controller.toggle(line)
  assert.equal(controller.persist(), true)
  const saved = JSON.parse(disk.entries.get(key))
  assert.deepEqual(saved.doneLineIds, [line])
  assert.equal(saved.demandIdentity, JSON.parse(valid).demandIdentity)
  assert.equal(disk.writes, 1)
})
