import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

function productsForStore(storeId, priceDeltaCents = 0) {
  return [
    ...m2Products.map((product) => ({
      ...product,
      id: `${storeId}-${product.id}`,
      storeId,
      priceCents: Math.max(0, product.priceCents + priceDeltaCents),
    })),
    {
      id: `${storeId}-garam-50`,
      storeId,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + priceDeltaCents,
    },
  ]
}

function buildCompleteBasket(store, priceDeltaCents = 0) {
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: productsForStore(store.id, priceDeltaCents),
  })
}

for (const paddedCandidateId of ['same-store ', ' same-store']) {
  test(`M3 comparison fails closed when candidate store id is padded: ${JSON.stringify(paddedCandidateId)}`, () => {
    const baseline = buildCompleteBasket(
      { id: 'same-store', name: 'Baseline store' },
      0,
    )
    const candidate = buildCompleteBasket(
      { id: paddedCandidateId, name: 'Candidate store' },
      -10,
    )

    const comparison = compareFullBaskets({ baseline, candidate })

    assert.equal(comparison.claimable, false)
    assert.equal(comparison.outcome, 'unknown')
    assert.equal(comparison.deltaCents, null)
    assert.equal(comparison.savingsCents, null)
    assert.deepEqual(comparison.lineDeltas, [])
    assert.match(
      comparison.reasons.join(' '),
      /candidate basket has an invalid store identity/,
    )
  })
}

test('M3 comparison remains claimable for distinct canonical store ids', () => {
  const baseline = buildCompleteBasket(
    { id: 'baseline-store', name: 'Baseline store' },
    0,
  )
  const candidate = buildCompleteBasket(
    { id: 'candidate-store', name: 'Candidate store' },
    -10,
  )

  const comparison = compareFullBaskets({ baseline, candidate })

  assert.equal(comparison.claimable, true)
  assert.notEqual(comparison.outcome, 'unknown')
  assert.equal(comparison.reasons.length, 0)
})
