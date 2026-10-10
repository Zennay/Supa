import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts,
  m3BaselineStore,
  m3CandidateProducts,
  m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'
import { euro } from '../src/lib/money.ts'
import {
  basketComparisonCanShowMoney,
  basketComparisonHeadline,
  basketCostDisclosure,
} from '../src/features/basket/basketPresentation.ts'

function basket(store, products) {
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    activeDays: m2DefaultActiveDays,
    recipes: m2Recipes,
    products,
  })
}

test('active four-meal fixture runs through actual basket → comparator → exact user headline', () => {
  const baseline = basket(m3BaselineStore, m3BaselineProducts)
  const candidate = basket(m3CandidateStore, m3CandidateProducts)
  assert.equal(baseline.selectedMealCount, 4)
  assert.equal(candidate.selectedMealCount, 4)
  assert.equal(baseline.unresolvedLineCount, 0)
  assert.equal(candidate.unresolvedLineCount, 0)

  const comparison = compareFullBaskets({ baseline, candidate })
  assert.equal(comparison.claimable, true)
  assert.equal(comparison.outcome, 'better')
  assert.equal(basketComparisonCanShowMoney(comparison, candidate), true)
  assert.equal(basketComparisonHeadline(comparison, candidate),
    `${candidate.store.name} ligt ${euro.formatCents(comparison.savingsCents)} lager`)
  assert.equal(basketCostDisclosure(baseline.totalCents, 0).state, 'complete')
  assert.equal(basketCostDisclosure(candidate.totalCents, 0).state, 'complete')
})

test('same complete demand with a more expensive candidate still exposes the worse result', () => {
  // Fixtures are cloned, never mutated. Synthetic variation is not a retailer observation.
  const candidatePrices = m3CandidateProducts.map((product) => ({
    ...product,
    priceCents: product.priceCents + 100,
  }))
  const baseline = basket(m3BaselineStore, m3BaselineProducts)
  const candidate = basket(m3CandidateStore, candidatePrices)
  const comparison = compareFullBaskets({ baseline, candidate })

  assert.equal(comparison.claimable, true)
  assert.equal(comparison.outcome, 'worse')
  assert.equal(basketComparisonCanShowMoney(comparison, candidate), true)
  assert.equal(
    basketComparisonHeadline(comparison, candidate),
    `${candidate.store.name} ligt ${euro.formatCents(comparison.deltaCents)} hoger`,
  )
})

test('genuinely incomplete fixture candidate cannot become a price headline even if cheaper', () => {
  const baseline = basket(m3BaselineStore, m3BaselineProducts)
  const incomplete = m3CandidateProducts.filter((product) => !product.id.endsWith('garam-50'))
  const candidate = basket(m3CandidateStore, incomplete)
  const comparison = compareFullBaskets({ baseline, candidate })

  assert.ok(candidate.unresolvedLineCount > 0)
  assert.equal(comparison.outcome, 'unknown')
  assert.equal(comparison.claimable, false)
  assert.equal(basketComparisonCanShowMoney(comparison, candidate), false)
  assert.equal(basketComparisonHeadline(comparison, candidate), 'Nog geen betrouwbare vergelijking')
  assert.equal(basketCostDisclosure(candidate.totalCents, candidate.unresolvedLineCount).state, 'minimum')
})
