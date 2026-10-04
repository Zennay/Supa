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

function comparisonFor(plan = m2InitialPlan, activeDays = m2DefaultActiveDays) {
  const baseline = buildOneStoreBasket({
    store: m3BaselineStore,
    plan,
    recipes: m2Recipes,
    activeDays,
    products: m3BaselineProducts,
  })
  const candidate = buildOneStoreBasket({
    store: m3CandidateStore,
    plan,
    recipes: m2Recipes,
    activeDays,
    products: m3CandidateProducts,
  })
  return {
    baseline,
    candidate,
    comparison: compareFullBaskets({ baseline, candidate }),
  }
}

test('M3 product-flow fixture compares the same complete default week', () => {
  const { baseline, candidate, comparison } = comparisonFor()

  assert.equal(baseline.unresolvedLineCount, 0)
  assert.equal(candidate.unresolvedLineCount, 0)
  assert.equal(comparison.claimable, true)
  assert.equal(comparison.outcome, 'better')
  assert.equal(comparison.savingsCents, 120)
})

test('M3 comparison follows the same recipe change as the planner state', () => {
  const changedPlan = m2InitialPlan.map((meal) =>
    meal.day === 'Di' ? { ...meal, recipeId: 'pasta' } : meal,
  )
  const { baseline, candidate, comparison } = comparisonFor(changedPlan)

  assert.equal(baseline.totalCents, 2469)
  assert.equal(candidate.totalCents, 2369)
  assert.equal(comparison.claimable, true)
  assert.equal(comparison.outcome, 'better')
  assert.equal(comparison.savingsCents, 100)
})
