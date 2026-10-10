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
  restoreShoppingListProgress,
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

test('shopping progress filters hostile persisted line-id arrays fail closed', () => {
  const basket = defaultBasket()
  const validId = basket.lines[0].id
  const raw = JSON.stringify({
    schemaVersion: 1,
    basketKey: shoppingListBasketKey(basket),
    doneLineIds: [
      validId,
      validId,
      'not-a-current-line',
      null,
      42,
      true,
      {},
      [],
    ],
  })

  assert.deepEqual(restoreShoppingListProgress(basket, raw), [validId])
})

test('shopping progress rejects non-array persisted line ids', () => {
  const basket = defaultBasket()

  for (const doneLineIds of [null, validObject(), 'line-id', 1, true]) {
    const raw = JSON.stringify({
      schemaVersion: 1,
      basketKey: shoppingListBasketKey(basket),
      doneLineIds,
    })

    assert.deepEqual(restoreShoppingListProgress(basket, raw), [])
  }
})

function validObject() {
  return { 0: 'line-id', length: 1 }
}
