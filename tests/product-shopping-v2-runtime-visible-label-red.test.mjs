import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { serializeShoppingProgressV2 } from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { shoppingListRowsV2 } from '../src/features/shopping-list/shoppingListRowsV2.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'

function fixture() {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: ['Di'], products: m2Products,
  })
}

function malformed(target, value) {
  const result = structuredClone(fixture())
  const matched = result.lines.find((line) => line.status === 'matched')
  assert.ok(matched)
  if (target === 'store') result.store.name = value
  if (target === 'ingredient') matched.ingredientLabel = value
  if (target === 'product') matched.productName = value
  if (target === 'unresolved') {
    matched.status = 'unresolved'
    matched.ingredientLabel = value
  }
  return result
}

// Synthetic runtime/JSON-boundary regression for existing issue #1101.
// Current domain basket builder supplies real strings; mutating these fixtures
// probes whether the *separate staged v2* can trust a malformed caller.
for (const [target, valueName, value] of [
  ['store', 'missing', undefined],
  ['store', 'empty', ''],
  ['store', 'whitespace', ' \t '],
  ['store', 'object', { suspicious: 'not text' }],
  ['ingredient', 'missing', undefined],
  ['ingredient', 'blank', '\n'],
  ['ingredient', 'object', { candidate: 1 }],
  ['product', 'missing', undefined],
  ['product', 'blank', '   '],
  ['product', 'object', { candidate: 1 }],
  ['unresolved', 'null', null],
  ['unresolved', 'array', ['not a label']],
]) {
  test(`product #1101 expected RED: malformed ${target} ${valueName} cannot be a durable visible shopping task`, () => {
    const basket = malformed(target, value)
    const untouched = structuredClone(basket)
    const writes = []
    const controller = openShoppingProgressStorageV2(basket, {
      getItem: () => null,
      setItem: (key, raw) => writes.push([key, raw]),
    })
    assert.equal(shoppingListDemandIdentity(basket), null)
    assert.equal(serializeShoppingProgressV2(basket, basket.lines.map((line) => line.id)), null)
    assert.equal(controller.snapshot().serialized, null)
    assert.equal(controller.toggle(basket.lines[0].id).serialized, null)
    assert.equal(controller.persist(), false)
    assert.deepEqual(shoppingListRowsV2(basket, controller.snapshot()), [])
    assert.deepEqual(writes, [])
    assert.deepEqual(basket, untouched)
  })
}

test('product #1101 safe control: readable renamed labels are presentation-only, not a new physical purchase', () => {
  const first = fixture()
  const edited = structuredClone(first)
  edited.store.name = 'Winkel met nieuwe naam'
  for (const line of edited.lines) {
    line.ingredientLabel = 'Verse ' + line.ingredientLabel
    if (line.status === 'matched') line.productName = 'Product: ' + line.productName
  }
  const originalIdentity = shoppingListDemandIdentity(first)
  assert.equal(typeof originalIdentity, 'string')
  assert.equal(shoppingListDemandIdentity(edited), originalIdentity)
  const controller = openShoppingProgressStorageV2(first, null)
  const matched = first.lines.find((line) => line.status === 'matched')
  assert.ok(matched)
  controller.toggle(matched.id)
  assert.ok(controller.rebase(edited).completedLineIds.includes(matched.id))
  assert.equal(shoppingListRowsV2(edited, controller.snapshot()).find((line) => line.id === matched.id).checked, true)
})
