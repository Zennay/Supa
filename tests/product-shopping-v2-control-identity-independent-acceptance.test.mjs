import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { serializeShoppingProgressV2 } from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListRowsV2 } from '../src/features/shopping-list/shoppingListRowsV2.ts'

function fixture() {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products: m2Products,
  })
}

function altered(which, id) {
  const basket = structuredClone(fixture())
  const row = basket.lines.find((line) => line.status === 'matched')
  assert.ok(row)
  if (which === 'store') basket.store.id = id
  if (which === 'ingredient') row.id = id
  if (which === 'product') row.productId = id
  return basket
}

for (const [name, which, value] of [
  ['SOH C0 store', 'store', '\u0001'],
  ['BS C0 ingredient', 'ingredient', '\u0008'],
  ['SO C0 product', 'product', '\u000e'],
  ['US C0 store', 'store', '\u001f'],
  ['PAD C1 ingredient', 'ingredient', '\u0080'],
  ['OSC C1 product', 'product', '\u009d'],
  ['highest lone high surrogate ingredient', 'ingredient', '\udbff'],
  ['highest lone low surrogate store', 'store', '\udfff'],
]) {
  test('product #1805 independent acceptance: invisible ' + name + ' is not a shopping task', () => {
    const basket = altered(which, value)
    const prior = structuredClone(basket)
    const saved = []
    const controller = openShoppingProgressStorageV2(basket, {
      getItem: () => null,
      setItem: (key, data) => saved.push([key, data]),
    })
    assert.equal(shoppingListDemandIdentity(basket), null)
    assert.equal(serializeShoppingProgressV2(basket, ['ingredient']), null)
    assert.equal(controller.snapshot().serialized, null)
    controller.toggle(basket.lines[0].id)
    assert.equal(controller.persist(), false)
    assert.deepEqual(shoppingListRowsV2(basket, controller.snapshot()), [])
    assert.deepEqual(saved, [])
    assert.deepEqual(basket, prior)
  })
}

test('product #1805: visible multilingual, punctuation, decomposed and emoji IDs remain writable', () => {
  for (const id of ['markt-🥦', 'عربي', 'हिन्दी', 'overzicht-Één', 'cafe\u0301', '🧑‍🍳', '#42', 'A\u200cZ']) {
    for (const which of ['store', 'ingredient', 'product']) {
      const basket = altered(which, id)
      const identity = shoppingListDemandIdentity(basket)
      assert.equal(typeof identity, 'string', which + ' ' + id)
      const saved = []
      const controller = openShoppingProgressStorageV2(basket, {
        getItem: () => null,
        setItem: (key, data) => saved.push([key, data]),
      })
      assert.equal(controller.persist(), true, 'valid physical task can save')
      assert.equal(saved.length, 1)
      assert.equal(JSON.parse(saved[0][1]).demandIdentity, identity)
    }
  }
})

test('product #1805: price-only change retains visible physical identity; product change invalidates', () => {
  const original = fixture()
  const changedPrice = structuredClone(original)
  const row = changedPrice.lines.find((line) => line.status === 'matched')
  assert.ok(row)
  row.pricePerPackCents += 1
  row.lineTotalCents += row.packs
  changedPrice.totalCents += row.packs
  assert.equal(shoppingListDemandIdentity(changedPrice), shoppingListDemandIdentity(original))
  row.productId += '-alternative'
  assert.notEqual(shoppingListDemandIdentity(changedPrice), shoppingListDemandIdentity(original))
})
