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

// Store choice must be reversible in the deterministic price engine.
// These fixture prices are NOT observed customer savings or evidence of
// permission to reuse live retailer data.
function basket(store, products, plan, activeDays) {
  return buildOneStoreBasket({
    store,
    products,
    plan,
    activeDays,
    recipes: m2Recipes,
  })
}

function assertReversible(baseline, candidate) {
  const forward = compareFullBaskets({ baseline, candidate })
  const inverse = compareFullBaskets({ baseline: candidate, candidate: baseline })

  assert.equal(forward.claimable, true)
  assert.equal(inverse.claimable, true)
  assert.equal(forward.outcome === 'unknown', false)
  assert.equal(inverse.outcome === 'unknown', false)
  assert.equal(forward.baselineTotalCents, inverse.candidateTotalCents)
  assert.equal(forward.candidateTotalCents, inverse.baselineTotalCents)
  assert.equal(forward.deltaCents + inverse.deltaCents, 0)
  assert.equal(forward.savingsCents + inverse.savingsCents, 0)

  const expectedInverseOutcome = {
    better: 'worse',
    worse: 'better',
    same: 'same',
  }[forward.outcome]
  assert.equal(inverse.outcome, expectedInverseOutcome)

  const inverseById = new Map(inverse.lineDeltas.map((line) => [line.id, line]))
  assert.equal(forward.lineDeltas.length, inverse.lineDeltas.length)
  for (const line of forward.lineDeltas) {
    const swapped = inverseById.get(line.id)
    assert.ok(swapped)
    assert.equal(line.ingredientLabel, swapped.ingredientLabel)
    assert.equal(line.baselineLineTotalCents, swapped.candidateLineTotalCents)
    assert.equal(line.candidateLineTotalCents, swapped.baselineLineTotalCents)
    assert.equal(line.deltaCents + swapped.deltaCents, 0)
  }
  assert.equal(
    forward.lineDeltas.reduce((sum, line) => sum + line.deltaCents, 0),
    forward.deltaCents,
  )
}

test('product M3: switching baseline and candidate reverses every signed basket cent across week selections', () => {
  const altered = m2InitialPlan.map((meal) =>
    meal.day === 'Di' ? { ...meal, recipeId: 'pasta' } : meal,
  )
  const cases = [
    { plan: m2InitialPlan, activeDays: m2DefaultActiveDays },
    { plan: m2InitialPlan, activeDays: ['Ma', 'Wo'] },
    { plan: m2InitialPlan, activeDays: ['Di', 'Do'] },
    { plan: m2InitialPlan, activeDays: ['Ma'] },
    { plan: altered, activeDays: m2DefaultActiveDays },
  ]
  for (const { plan, activeDays } of cases) {
    assertReversible(
      basket(m3BaselineStore, m3BaselineProducts, plan, activeDays),
      basket(m3CandidateStore, m3CandidateProducts, plan, activeDays),
    )
  }
})

test('product M3: reversing store choice remains cent-exact after any one synthetic candidate pack reprices by one cent', () => {
  const baseline = basket(
    m3BaselineStore,
    m3BaselineProducts,
    m2InitialPlan,
    m2DefaultActiveDays,
  )
  for (const changedProduct of m3CandidateProducts) {
    const repricedProducts = m3CandidateProducts.map((product) =>
      product.id === changedProduct.id
        ? { ...product, priceCents: product.priceCents + 1 }
        : product,
    )
    const candidate = basket(
      m3CandidateStore,
      repricedProducts,
      m2InitialPlan,
      m2DefaultActiveDays,
    )
    assertReversible(baseline, candidate)
  }
})
