import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

test('basket construction rejects blank active ingredient labels', () => {
  for (const invalidLabel of ['', '   ', null]) {
    const recipes = structuredClone(m2Recipes)
    recipes[0].ingredients[0].label = invalidLabel

    assert.throws(
      () =>
        buildOneStoreBasket({
          store: m2Store,
          plan: m2InitialPlan,
          recipes,
          activeDays: ['Ma'],
          products: m2Products,
        }),
      /Ingredient label must be non-blank/,
    )
  }
})
