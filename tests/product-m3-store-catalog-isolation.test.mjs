import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Recipes,
} from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts,
  m3BaselineStore,
  m3CandidateProducts,
  m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

// Controlled demonstration fixtures only. No supermarket observation,
// source licence, public savings claim, or M3 field gate follows from this test.
const weeks = [
  m2DefaultActiveDays,
  ['Ma', 'Wo'],
  ['Di', 'Do'],
  ['Ma'],
]

function basket(store, products, activeDays) {
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays,
    products,
  })
}

function pair(baseProducts, candidateProducts, activeDays) {
  const baseline = basket(m3BaselineStore, baseProducts, activeDays)
  const candidate = basket(m3CandidateStore, candidateProducts, activeDays)
  return {
    baseline,
    candidate,
    comparison: compareFullBaskets({ baseline, candidate }),
  }
}

test('product M3: single-store catalogs and combined catalogs produce the same physical two-store result', () => {
  const combined = [...m3CandidateProducts, ...m3BaselineProducts]
  for (const activeDays of weeks) {
    const isolated = pair(m3BaselineProducts, m3CandidateProducts, activeDays)
    const reversedCombined = [...combined].reverse()
    const shared = pair(combined, combined, activeDays)
    const reversed = pair(reversedCombined, reversedCombined, activeDays)

    assert.deepEqual(shared, isolated)
    assert.deepEqual(reversed, isolated)
    assert.equal(shared.baseline.store.id, m3BaselineStore.id)
    assert.equal(shared.candidate.store.id, m3CandidateStore.id)
    assert.notEqual(shared.baseline.store.id, shared.candidate.store.id)
  }
})

test('product M3: foreign-store near-zero duplicates cannot contaminate purchased packs or savings', () => {
  const foreignStoreId = 'not-a-selected-store'
  const foreignProducts = [
    ...m3BaselineProducts,
    ...m3CandidateProducts,
  ].map((product) => ({
    ...product,
    storeId: foreignStoreId,
    priceCents: 0,
    name: product.name,
  }))

  for (const activeDays of weeks) {
    const isolated = pair(m3BaselineProducts, m3CandidateProducts, activeDays)
    const combined = [...m3BaselineProducts, ...m3CandidateProducts]
    // The adversarial synthetic offers repeat valid IDs from the actual
    // fixture catalogs, but have a third storeId and cannot become eligible.
    const contaminated = [
      ...foreignProducts,
      ...combined,
      ...foreignProducts.slice().reverse(),
    ]

    const result = pair(contaminated, contaminated, activeDays)
    assert.deepEqual(result, isolated)
    assert.equal(result.comparison.claimable, true)
    assert.equal(
      result.comparison.savingsCents,
      result.baseline.totalCents - result.candidate.totalCents,
    )
  }
})

test('product M3: adding an unavailable foreign-store listing never replaces the chosen physical pack', () => {
  const unrelated = {
    ...m3BaselineProducts[0],
    storeId: 'outside-scope',
    name: 'Out-of-scope offer',
    available: false,
    priceCents: 0,
  }
  for (const activeDays of weeks) {
    const reference = pair(m3BaselineProducts, m3CandidateProducts, activeDays)
    const enhanced = pair(
      [unrelated, ...m3BaselineProducts],
      [unrelated, ...m3CandidateProducts],
      activeDays,
    )
    assert.deepEqual(enhanced, reference)
  }
})
