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

// Synthetic deterministic economics only; does not provide M3 retailer field evidence.
function complete(storeId, priceAdjustment = 0) {
  const store = { ...m2Store, id: storeId }
  const products = [
    ...m2Products.map((product) => ({
      ...product,
      id: `${storeId}-${product.id}`,
      storeId,
      priceCents: product.priceCents + priceAdjustment,
    })),
    {
      id: `${storeId}-garam-50`,
      storeId,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + priceAdjustment,
    },
  ]
  const basket = buildOneStoreBasket({
    store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(basket.unresolvedLineCount, 0)
  return basket
}

test('C12: equal complete baskets do not claim a cheaper store', () => {
  const baseline = complete('tie-baseline')
  const candidate = complete('tie-candidate')
  const comparison = compareFullBaskets({ baseline, candidate })

  assert.equal(comparison.claimable, true)
  assert.equal(comparison.outcome, 'same')
  assert.equal(comparison.deltaCents, 0)
  assert.equal(comparison.savingsCents, 0)
  assert.ok(comparison.lineDeltas.length > 0)
  assert.ok(comparison.lineDeltas.every((line) => line.deltaCents === 0))
})

test('complete basket delta reconciles with every ingredient delta and reverses exactly', () => {
  const baseline = complete('reconcile-baseline')
  const candidate = complete('reconcile-candidate', 12)
  const forward = compareFullBaskets({ baseline, candidate })
  const reverse = compareFullBaskets({ baseline: candidate, candidate: baseline })

  assert.equal(forward.claimable, true)
  assert.equal(reverse.claimable, true)
  assert.equal(forward.outcome, 'worse')
  assert.equal(reverse.outcome, 'better')
  assert.equal(forward.deltaCents, candidate.totalCents - baseline.totalCents)
  assert.equal(forward.savingsCents, -forward.deltaCents)
  assert.equal(reverse.deltaCents, -forward.deltaCents)
  assert.equal(reverse.savingsCents, -forward.savingsCents)
  assert.equal(
    forward.lineDeltas.reduce((total, line) => total + line.deltaCents, 0),
    forward.deltaCents,
  )
  assert.deepEqual(
    forward.lineDeltas.map((line) => line.id).sort(),
    reverse.lineDeltas.map((line) => line.id).sort(),
  )
})
