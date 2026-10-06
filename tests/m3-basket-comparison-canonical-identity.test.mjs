import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

function productsForStore(storeId) {
  return [
    ...m2Products.map((product) => ({
      ...product,
      id: `${storeId}-${product.id}`,
      storeId,
    })),
    {
      id: `${storeId}-garam-50`,
      storeId,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139,
    },
  ]
}

function buildCompleteBasket(store) {
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: productsForStore(store.id),
  })
}

test('M3 comparison rejects a padded store identity instead of treating the same store as different', () => {
  const baselineStore = {
    ...m2Store,
    id: 'same-store',
    name: 'Same store',
  }
  const paddedStore = {
    ...baselineStore,
    id: 'same-store ',
  }

  const baseline = buildCompleteBasket(baselineStore)
  const candidate = buildCompleteBasket(paddedStore)

  const comparison = compareFullBaskets({ baseline, candidate })

  assert.equal(comparison.claimable, false)
  assert.equal(comparison.outcome, 'unknown')
  assert.equal(comparison.deltaCents, null)
  assert.equal(comparison.savingsCents, null)
  assert.match(
    comparison.reasons.join(' '),
    /candidate basket has an invalid store identity/,
  )
})

test('M3 comparison still accepts canonical cross-store identities', () => {
  const baselineStore = {
    ...m2Store,
    id: 'canonical-store-a',
    name: 'Canonical store A',
  }
  const candidateStore = {
    ...m2Store,
    id: 'canonical-store-b',
    name: 'Canonical store B',
  }

  const comparison = compareFullBaskets({
    baseline: buildCompleteBasket(baselineStore),
    candidate: buildCompleteBasket(candidateStore),
  })

  assert.equal(comparison.claimable, true)
  assert.equal(comparison.outcome, 'same')
  assert.equal(comparison.deltaCents, 0)
  assert.equal(comparison.savingsCents, 0)
  assert.deepEqual(comparison.reasons, [])
})
