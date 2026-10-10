import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

const stores = [
  { ...m2Store, id: 'synthetic-baseline' },
  { ...m2Store, id: 'synthetic-candidate' },
]

function basket(store, activeDays) {
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays,
    products: m2Products.map((product) => ({ ...product, storeId: store.id })),
  })
}

function noClaim(comparison, reason) {
  assert.equal(comparison.outcome, 'unknown', reason)
  assert.equal(comparison.claimable, false, reason)
  assert.equal(comparison.deltaCents, null, reason)
  assert.equal(comparison.savingsCents, null, reason)
  assert.deepEqual(comparison.lineDeltas, [], reason)
  assert.ok(comparison.reasons.length > 0, 'must provide deterministic reason for abstention')
}

test('two genuine empty active planner weeks cannot become a monetary equality claim (#1051)', () => {
  const [baseline, candidate] = stores.map((store) => basket(store, []))
  assert.equal(baseline.selectedMealCount, 0)
  assert.equal(candidate.selectedMealCount, 0)
  assert.deepEqual(baseline.lines, [])
  assert.deepEqual(candidate.lines, [])

  const before = structuredClone({ baseline, candidate })
  const result = compareFullBaskets({ baseline, candidate })
  noClaim(result, 'no selected groceries means no justified full-basket comparison')
  assert.equal(result.baselineTotalCents, 0)
  assert.equal(result.candidateTotalCents, 0)
  assert.deepEqual({ baseline, candidate }, before)
})

test('two contradictory nonempty-meal snapshots without ingredient lines must also abstain', () => {
  const baseline = { ...basket(stores[0], []), selectedMealCount: 1 }
  const candidate = { ...basket(stores[1], []), selectedMealCount: 1 }
  noClaim(
    compareFullBaskets({ baseline, candidate }),
    'an asserted planned meal without basket lines is not evidence of equal prices',
  )
})

test('one empty and one real nonempty store basket must never expose cent difference', () => {
  const baseline = basket(stores[0], [])
  const candidate = basket(stores[1], ['Di'])
  assert.ok(candidate.lines.length > 0)
  noClaim(compareFullBaskets({ baseline, candidate }), 'asymmetric demand is incomparable')
})

test('real nonempty matched equal-price baskets remain a valid controlled equality', () => {
  const [baseline, candidate] = stores.map((store) => basket(store, ['Di']))
  assert.equal(baseline.unresolvedLineCount, 0)
  assert.equal(candidate.unresolvedLineCount, 0)
  assert.ok(baseline.lines.length > 0)

  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.outcome, 'same')
  assert.equal(result.claimable, true)
  assert.equal(result.deltaCents, 0)
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, baseline.lines.length)
  assert.deepEqual(result.reasons, [])
})
