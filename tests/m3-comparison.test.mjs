import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareStoreBaskets } from '../src/domain/comparison.ts'
import {
  m3BaselineProducts,
  m3BaselineStore,
  m3CandidateProducts,
  m3CandidateStore,
  m3DefaultActiveDays,
  m3InitialPlan,
  m3Recipes,
} from '../src/data/m3Fixture.ts'
import { m2Products } from '../src/data/m2Fixture.ts'

function basket(store, products, activeDays = m3DefaultActiveDays) {
  return buildOneStoreBasket({
    store,
    plan: m3InitialPlan,
    recipes: m3Recipes,
    activeDays,
    products,
  })
}

test('M3 controlled comparison uses one explicit complete-basket baseline', () => {
  const baseline = basket(m3BaselineStore, m3BaselineProducts)
  const candidate = basket(m3CandidateStore, m3CandidateProducts)
  const result = compareStoreBaskets({ baseline, candidate })

  assert.equal(baseline.unresolvedLineCount, 0)
  assert.equal(candidate.unresolvedLineCount, 0)
  assert.equal(baseline.totalCents, 3147)
  assert.equal(candidate.totalCents, 3077)

  assert.equal(result.claimable, true)
  assert.equal(result.direction, 'cheaper')
  assert.equal(result.deltaCents, 70)
  assert.ok(Math.abs(result.savingsRate - 70 / 3147) < 1e-12)
  assert.equal(result.effects.packSizeCents, null)
  assert.equal(result.effects.offerCents, null)
  assert.equal(result.effects.planningCents, null)
  assert.equal(result.effects.unexplainedCents, 70)
})

test('M3 keeps a worse second-store outcome instead of optimizing it away', () => {
  const baseline = basket(m3BaselineStore, m3BaselineProducts)
  const expensiveProducts = m3CandidateProducts.map((product) =>
    product.id === 'b-chicken-400'
      ? { ...product, priceCents: product.priceCents + 500 }
      : product,
  )
  const candidate = basket(m3CandidateStore, expensiveProducts)
  const result = compareStoreBaskets({ baseline, candidate })

  assert.equal(result.claimable, true)
  assert.equal(result.direction, 'worse')
  assert.equal(result.deltaCents, -930)
  assert.equal(result.effects.unexplainedCents, -930)
})

test('M3 refuses a savings delta when either basket has unresolved ingredients', () => {
  const incompleteBaseline = basket(m3BaselineStore, m2Products)
  const candidate = basket(m3CandidateStore, m3CandidateProducts)
  const result = compareStoreBaskets({
    baseline: incompleteBaseline,
    candidate,
  })

  assert.equal(incompleteBaseline.unresolvedLineCount, 1)
  assert.equal(result.claimable, false)
  assert.equal(result.direction, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsRate, null)
  assert.match(result.reasons.join(' '), /baseline unresolved ingredient: garam-masala/)
})

test('M3 refuses comparison when the selected week differs', () => {
  const baseline = basket(m3BaselineStore, m3BaselineProducts)
  const candidate = basket(
    m3CandidateStore,
    m3CandidateProducts,
    ['Ma', 'Di', 'Wo'],
  )
  const result = compareStoreBaskets({ baseline, candidate })

  assert.equal(result.claimable, false)
  assert.equal(result.direction, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.match(result.reasons.join(' '), /selected meal count differs/)
  assert.match(result.reasons.join(' '), /basket requirement differs/)
})

test('M3 effect attribution preserves unknown remainder explicitly', () => {
  const baseline = basket(m3BaselineStore, m3BaselineProducts)
  const candidate = basket(m3CandidateStore, m3CandidateProducts)
  const result = compareStoreBaskets({
    baseline,
    candidate,
    effects: {
      packSizeCents: 40,
      offerCents: null,
      planningCents: 10,
    },
  })

  assert.equal(result.deltaCents, 70)
  assert.equal(result.effects.packSizeCents, 40)
  assert.equal(result.effects.offerCents, null)
  assert.equal(result.effects.planningCents, 10)
  assert.equal(result.effects.unexplainedCents, 20)
})

test('M3 comparison rejects internally inconsistent basket totals', () => {
  const baseline = basket(m3BaselineStore, m3BaselineProducts)
  const candidate = basket(m3CandidateStore, m3CandidateProducts)
  const tampered = { ...candidate, totalCents: candidate.totalCents - 1 }
  const result = compareStoreBaskets({ baseline, candidate: tampered })

  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.match(result.reasons.join(' '), /basket total does not equal matched line trace/)
})
