import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'
import {
  serializeShoppingListProgress,
  shoppingListBasketKey,
} from '../src/features/shopping-list/shoppingListProgress.ts'

function defaultBasket() {
  return buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: m2Products,
  })
}

function serializedDoneLineIds(basket, doneLineIds) {
  return JSON.parse(serializeShoppingListProgress(basket, doneLineIds)).doneLineIds
}

test('shopping progress serialization fails closed for non-array runtime inputs', () => {
  const basket = defaultBasket()

  for (const doneLineIds of [null, undefined, {}, 'line-id', 1, true]) {
    assert.deepEqual(serializedDoneLineIds(basket, doneLineIds), [])
  }
})

test('shopping progress serialization keeps only unique current string line ids', () => {
  const basket = defaultBasket()
  const validId = basket.lines[0].id

  const serialized = JSON.parse(
    serializeShoppingListProgress(basket, [
      validId,
      validId,
      'not-a-current-line',
      null,
      42,
      true,
      {},
    ]),
  )

  assert.equal(serialized.schemaVersion, 1)
  assert.equal(serialized.basketKey, shoppingListBasketKey(basket))
  assert.deepEqual(serialized.doneLineIds, [validId])
})
