import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

test('basket construction rejects blank or malformed store display names', () => {
  for (const invalidName of ['', '   ', null, 42]) {
    const store = { ...m2Store, name: invalidName }

    assert.throws(
      () =>
        buildOneStoreBasket({
          store,
          plan: m2InitialPlan,
          recipes: m2Recipes,
          activeDays: ['Ma'],
          products: m2Products,
        }),
      /Store name must be non-blank/,
    )
  }
})
