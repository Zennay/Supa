import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { euro } from '../src/lib/money.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  m3BaselineStore, m3CandidateStore,
  m3BaselineProducts, m3CandidateProducts,
} from '../src/data/m3ComparisonFixture.ts'

function basket(store, products, activeDays = m2DefaultActiveDays) {
  return buildOneStoreBasket({
    store, products, activeDays,
    plan: m2InitialPlan, recipes: m2Recipes,
  })
}

test('product: cent-exact custom budgets around a real calculated demo basket boundary', () => {
  const base = basket(m3BaselineStore, m3BaselineProducts)
  assert.equal(base.unresolvedLineCount, 0)
  assert.equal(base.lines.length, 11)
  const cents = base.totalCents
  assert.ok(cents > 1 && cents < 100_000)
  for (const offset of [-1, 0, 1]) {
    const selectedBudgetCents = cents + offset
    const result = assessPlannerBudgetCents(cents, selectedBudgetCents / 100, 0)
    assert.equal(result.status, 'known')
    assert.equal(result.budgetCents, selectedBudgetCents)
    assert.equal(result.plannedCostCents, cents)
    assert.equal(result.remainingCents, offset)
    assert.equal(result.remainingLabel, euro.formatCents(offset))
    assert.equal(result.overBudget, offset < 0)
  }
})

test('product: known store budgets do not turn changed meal demand into a savings comparison', () => {
  const baseline = basket(m3BaselineStore, m3BaselineProducts)
  const candidate = basket(
    m3CandidateStore, m3CandidateProducts, m2DefaultActiveDays.slice(0, -1),
  )
  assert.equal(baseline.selectedMealCount, 4)
  assert.equal(candidate.selectedMealCount, 3)
  for (const b of [baseline, candidate]) {
    assert.equal(b.unresolvedLineCount, 0)
    assert.equal(assessPlannerBudgetCents(b.totalCents, 35, b.unresolvedLineCount).status, 'known')
  }
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
})

test('product: known candidate budget cannot rescue an unresolved baseline comparison', () => {
  const baseline = basket(
    m3BaselineStore,
    m3BaselineProducts.filter(p => !p.id.endsWith('-garam-50')),
  )
  const candidate = basket(m3CandidateStore, m3CandidateProducts)
  assert.equal(baseline.unresolvedLineCount, 1)
  assert.equal(candidate.unresolvedLineCount, 0)
  const baselineBudget = assessPlannerBudgetCents(
    baseline.totalCents, 35, baseline.unresolvedLineCount,
  )
  const candidateBudget = assessPlannerBudgetCents(
    candidate.totalCents, 35, candidate.unresolvedLineCount,
  )
  assert.equal(baselineBudget.status, 'unknown')
  assert.equal(candidateBudget.status, 'known')
  assert.equal('remainingCents' in baselineBudget, false)
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.savingsCents, null)
  assert.equal(result.deltaCents, null)
  assert.deepEqual(result.lineDeltas, [])
})
