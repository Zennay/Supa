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
  serializeShoppingListProgress,
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

test('shopping progress serialization fails closed for malformed containers', () => {
  const basket = defaultBasket()

  for (const malformed of [null, undefined, {}, 'line-id', 1, true]) {
    const raw = serializeShoppingListProgress(basket, malformed)
    assert.deepEqual(restoreShoppingListProgress(basket, raw), [])
  }
})

test('shopping progress serialization filters hostile array values', () => {
  const basket = defaultBasket()
  const validId = basket.lines[0].id

  const raw = serializeShoppingListProgress(basket, [
    validId,
    validId,
    'not-a-current-line',
    null,
    42,
    true,
    {},
    [],
  ])

  assert.deepEqual(restoreShoppingListProgress(basket, raw), [validId])
})
