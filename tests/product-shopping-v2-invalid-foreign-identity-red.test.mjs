import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Product-core #1603: a string-shaped but *invalid physical identity* is
// not a supported foreign shopping task. These are fabricated bytes only.
const inputs = {
  store: m2Store, products: m2Products, recipes: m2Recipes, plan: m2InitialPlan,
}
const basket = buildOneStoreBasket({ ...inputs, activeDays: ['Di'] })
const foreignBasket = buildOneStoreBasket({ ...inputs, activeDays: ['Di', 'Wo'] })
const tick = basket.lines.find((line) => line.status === 'matched')?.id
assert.ok(tick)
const valid = serializeShoppingProgressV2(basket, [])
assert.ok(valid)

function disk(raw) {
  let writes = 0
  const values = new Map([[key, raw]])
  return {
    values,
    get writes() { return writes },
    getItem(k) { return values.get(k) ?? null },
    setItem(k, v) { writes++; values.set(k, v) },
  }
}

for (const [name, identity] of [
  ['opaque non-JSON task identifier', 'synthetic-foreign-basket'],
  ['JSON object without physical line list', '{"schemaVersion":2,"storeId":"synthetic-other"}'],
  ['JSON with unsupported future physical identity schema', '{"schemaVersion":3,"storeId":"synthetic-other","lines":[]}'],
  ['JSON physical identity with extra unknown semantic field', '{"schemaVersion":2,"storeId":"synthetic-other","lines":[],"futureExtension":true}'],
  ['JSON identity with duplicated hidden store key', '{"schemaVersion":2,"storeId":"hidden","storeId":"synthetic-other","lines":[]}'],
]) {
  test(`Product #1603 expected RED: preserve unsupported foreign identity: ${name}`, () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
      demandIdentity: identity,
      doneLineIds: [],
    })
    const storage = disk(raw)
    const controller = openShoppingProgressStorageV2(basket, storage)
    assert.equal(controller.storageFormatStatus(), 'unknown-record')
    controller.toggle(tick)
    assert.equal(controller.persist(), false)
    controller.clear()
    assert.equal(controller.persist(), false)
    assert.equal(storage.values.get(key), raw)
    assert.equal(storage.writes, 0)
  })
}

test('Product #1603 positive: canonical serialized foreign physical task remains switchable', () => {
  const foreign = serializeShoppingProgressV2(foreignBasket, [])
  assert.ok(foreign)
  const storage = disk(foreign)
  const controller = openShoppingProgressStorageV2(basket, storage)
  assert.equal(controller.storageFormatStatus(), 'ready')
  controller.toggle(tick)
  assert.equal(controller.persist(), true)
  assert.equal(JSON.parse(storage.values.get(key)).demandIdentity, JSON.parse(valid).demandIdentity)
  assert.equal(storage.writes, 1)
})
