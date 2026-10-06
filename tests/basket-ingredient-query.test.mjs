import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

test('basket construction rejects blank or malformed active ingredient queries', () => {
  for (const invalidQuery of ['', '   ', null, 42]) {
    const recipes = structuredClone(m2Recipes)
    recipes[0].ingredients[0].query = invalidQuery

    assert.throws(
      () =>
        buildOneStoreBasket({
          store: m2Store,
          plan: m2InitialPlan,
          recipes,
          activeDays: ['Ma'],
          products: m2Products,
        }),
      /Ingredient query must be non-blank/,
    )
  }
})
