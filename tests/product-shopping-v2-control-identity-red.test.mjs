import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListRowsV2 } from '../src/features/shopping-list/shoppingListRowsV2.ts'

function controlled() {
  return buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: m2Products,
  })
}

function variant(target, id) {
  const next = structuredClone(controlled())
  const match = next.lines.find((line) => line.status === 'matched')
  assert.ok(match, 'M2 fixture must have a matched product')
  if (target === 'store') next.store.id = id
  if (target === 'line') match.id = id
  if (target === 'product') match.productId = id
  return next
}

for (const [label, target, id] of [
  ['NUL store', 'store', '\u0000'],
  ['BEL ingredient', 'line', '\u0007'],
  ['ESC product', 'product', '\u001b'],
  ['DEL store', 'store', '\u007f'],
  ['NEL ingredient', 'line', '\u0085'],
  ['C1 control product', 'product', '\u009f'],
  ['lone high surrogate store', 'store', '\ud800'],
  ['lone low surrogate product', 'product', '\udc00'],
]) {
  test('product #1805 expected RED: invisible ' + label + ' cannot mint a shopping task', () => {
    const basket = variant(target, id)
    const original = structuredClone(basket)
    const writes = []
    const controller = openShoppingProgressStorageV2(basket, {
      getItem: () => null,
      setItem: (...args) => writes.push(args),
    })

    assert.equal(shoppingListDemandIdentity(basket), null)
    assert.equal(controller.snapshot().serialized, null)
    assert.equal(controller.persist(), false)
    assert.deepEqual(shoppingListRowsV2(basket, controller.snapshot()), [])
    assert.deepEqual(writes, [])
    assert.deepEqual(basket, original)
  })
}

test('product #1805: printable IDs, accents and intentional format joiners stay usable', () => {
  for (const visibleId of ['plus-12', 'déká', 'cafe\u0301', '🥦', 'winkel-\u200d-planner', '_', '—']) {
    for (const target of ['store', 'line', 'product']) {
      const next = variant(target, visibleId)
      assert.equal(typeof shoppingListDemandIdentity(next), 'string', target + ' ' + visibleId)
      assert.notEqual(openShoppingProgressStorageV2(next, null).snapshot().serialized, null)
    }
  }
})
