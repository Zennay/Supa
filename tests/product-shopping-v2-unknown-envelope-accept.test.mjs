import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import {
  serializeShoppingProgressV2,
  shoppingListProgressV2StorageKey as key,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Separate independent product-core acceptance of the frozen #1681 repair.
// All baskets come from the fictional M2 fixture, not observed supermarket data.
const src = { store: m2Store, products: m2Products, recipes: m2Recipes, plan: m2InitialPlan }
const basketA = buildOneStoreBasket({ ...src, activeDays: ['Di'] })
const basketB = buildOneStoreBasket({ ...src, activeDays: ['Di', 'Wo'] })
const id = basketA.lines.find(row => row.status === 'matched')?.id
assert.ok(id)
const cleanA = serializeShoppingProgressV2(basketA, [id])
const cleanB = serializeShoppingProgressV2(basketB, [])
assert.ok(cleanA)
assert.ok(cleanB)

function port(raw) {
  const data = new Map([[key, raw]])
  let writes = 0
  return {
    data,
    get writes() { return writes },
    getItem(k) { return data.get(k) ?? null },
    setItem(k, v) { writes++; data.set(k, v) },
  }
}

for (const [name, extra] of [
  ['future client transient checkout metadata', { paymentGroup: { name: 'synthetic', amount: 0 } }],
  ['unknown false flag', { experimentalFeature: false }],
  ['unknown empty array', { additionalChecks: [] }],
  ['unknown escaped JSON property name', JSON.parse('{"future\\u0049d":"value"}')],
  ['unknown __proto__ root key', JSON.parse('{"__proto__":{"owner":"synthetic"}}')],
]) {
  test('Product #1603 independent: extension remains exactly intact after clear/rebase: ' + name, () => {
    const raw = JSON.stringify({ ...JSON.parse(cleanA), ...extra })
    assert.notEqual(raw, cleanA)
    const storage = port(raw)
    const controller = openShoppingProgressStorageV2(basketA, storage)
    assert.equal(controller.storageFormatStatus(), 'unknown-record')
    assert.equal(controller.reloadSaved(), null, 'unknown extension cannot be pinned as clean v2')
    controller.clear()
    assert.equal(controller.persist(), false)
    controller.rebase(basketB)
    assert.equal(controller.persist(), false)
    assert.equal(storage.data.get(key), raw)
    assert.equal(storage.writes, 0)
  })
}

test('Product #1603 independent: deliberate same-demand recovery after external correction', () => {
  const opaque = JSON.stringify({ ...JSON.parse(cleanA), syncEpoch: 123 })
  const storage = port(opaque)
  const controller = openShoppingProgressStorageV2(basketA, storage)
  controller.toggle(id)
  assert.equal(controller.persist(), false)
  assert.equal(storage.data.get(key), opaque)
  storage.data.set(key, cleanA)
  const recovered = controller.reloadSaved()
  assert.ok(recovered)
  assert.deepEqual(recovered.completedLineIds, [id])
  assert.equal(storage.writes, 0, 'recovery is read-only')
  controller.toggle(id)
  assert.equal(controller.persist(), true)
  assert.equal(storage.data.get(key), serializeShoppingProgressV2(basketA, []))
})

test('Product #1603 independent: well-formed canonical foreign task stays explicitly replaceable', () => {
  const storage = port(cleanB)
  const controller = openShoppingProgressStorageV2(basketA, storage)
  assert.equal(controller.storageFormatStatus(), 'ready')
  controller.toggle(id)
  assert.equal(controller.persist(), true)
  assert.equal(storage.data.get(key), cleanA)
  assert.equal(storage.writes, 1)
})

test('Product #1603 independent: financial-only price rebase keeps ordinary validated ticks', () => {
  const storage = port(cleanA)
  const controller = openShoppingProgressStorageV2(basketA, storage)
  const line = basketA.lines.find(x => x.status === 'matched')
  assert.ok(line)
  const changed = buildOneStoreBasket({
    ...src,
    activeDays: ['Di'],
    products: m2Products.map(p => p.id === line.productId ? { ...p, priceCents: p.priceCents + 1 } : p),
  })
  assert.notEqual(changed.totalCents, basketA.totalCents)
  assert.deepEqual(controller.rebase(changed).completedLineIds, [id])
  assert.equal(controller.persist(), true)
  assert.equal(storage.data.get(key), cleanA)
})
