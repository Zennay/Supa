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

function completeBasket(storeId) {
  return buildOneStoreBasket({
    store: { ...m2Store, id: storeId },
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: [
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
    ],
  })
}

function assertUnknown(result, message) {
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.savingsCents, null)
  assert.equal(result.deltaCents, null)
  assert.deepEqual(result.lineDeltas, [])
  assert.match(result.reasons.join(' '), message)
}

test('M3 rejects a basket with an unsupported line status, even if its price total looks complete', () => {
  const baseline = completeBasket('store-a')
  const candidate = structuredClone(completeBasket('store-b'))
  assert.equal(candidate.unresolvedLineCount, 0)
  candidate.lines[0].status = 'priced-but-unreviewed'
  assertUnknown(compareFullBaskets({ baseline, candidate }), /unsupported line shape or status/)
})

test('M3 rejects inconsistent matched counters instead of trusting the apparent cheaper total', () => {
  const baseline = completeBasket('store-a')
  const candidate = structuredClone(completeBasket('store-b'))
  candidate.matchedLineCount += 1
  assertUnknown(compareFullBaskets({ baseline, candidate }), /line counters are inconsistent/)
})

test('M3 rejects non-array candidate lines without turning an unavailable basket into a saving', () => {
  const baseline = completeBasket('store-a')
  const candidate = structuredClone(completeBasket('store-b'))
  candidate.lines = null
  assertUnknown(compareFullBaskets({ baseline, candidate }), /basket lines are not an array/)
})
