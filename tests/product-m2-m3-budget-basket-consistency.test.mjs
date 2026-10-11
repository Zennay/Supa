import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { euro } from '../src/lib/money.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Recipes,
} from '../src/data/m2Fixture.ts'
import {
  m3BaselineStore, m3CandidateStore,
  m3BaselineProducts, m3CandidateProducts,
} from '../src/data/m3ComparisonFixture.ts'

/** Controlled M2 four-meal / 11-ingredient baskets: never real store evidence. */
function basket(store, products) {
  return buildOneStoreBasket({
    store, products,
    plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
  })
}

function assertElevenDemand(b) {
  assert.equal(b.selectedMealCount, 4)
  assert.equal(b.lines.length, 11)
  assert.equal(b.matchedLineCount, 11)
  assert.equal(b.unresolvedLineCount, 0)
  assert.equal(b.totalCents, b.lines.reduce((sum, row) => sum + row.lineTotalCents, 0))
}

test('product M2→M3: cent-native weekly budget follows complete basket totals exactly', () => {
  const baseline = basket(m3BaselineStore, m3BaselineProducts)
  const candidate = basket(m3CandidateStore, m3CandidateProducts)
  for (const b of [baseline, candidate]) {
    assertElevenDemand(b)
    const a = assessPlannerBudgetCents(b.totalCents, 35, b.unresolvedLineCount)
    assert.equal(a.status, 'known')
    assert.equal(a.plannedCostCents, b.totalCents)
    assert.equal(a.remainingCents, 3500 - b.totalCents)
    assert.equal(a.remainingLabel, euro.formatCents(3500 - b.totalCents))
    assert.equal(a.overBudget, b.totalCents > 3500)
  }
  const c = compareFullBaskets({ baseline, candidate })
  assert.equal(c.claimable, true)
  assert.equal(c.deltaCents, candidate.totalCents - baseline.totalCents)
  assert.equal(c.savingsCents, baseline.totalCents - candidate.totalCents)
  assert.equal(c.lineDeltas.length, 11)
})

test('product M2→M3: same and one-cent-per-pack worse are physical, not per ingredient', () => {
  const baseline = basket(m3BaselineStore, m3BaselineProducts)
  const originalCandidate = m3BaselineProducts.map(p => ({
    ...p, id: 'candidate-' + p.id, storeId: m3CandidateStore.id,
  }))
  const same = basket(m3CandidateStore, originalCandidate)
  const worse = basket(m3CandidateStore, originalCandidate.map(p => ({
    ...p, priceCents: p.priceCents + 1,
  })))
  assertElevenDemand(baseline)
  assertElevenDemand(same)
  assertElevenDemand(worse)
  assert.equal(compareFullBaskets({ baseline, candidate: same }).outcome, 'same')
  const c = compareFullBaskets({ baseline, candidate: worse })
  assert.equal(c.claimable, true)
  assert.equal(c.outcome, 'worse')
  const physicalPacks = worse.lines.reduce((sum, line) => sum + line.packs, 0)
  assert.equal(c.deltaCents, physicalPacks)
  assert.equal(c.savingsCents, -physicalPacks)
  assert.equal(c.lineDeltas.reduce((sum, line) => sum + line.deltaCents, 0), physicalPacks)
})

test('product M2→M3: cheap incomplete candidate has no remaining-budget or savings claim', () => {
  const baseline = basket(m3BaselineStore, m3BaselineProducts)
  const withoutSpice = m3CandidateProducts
    .filter(p => !p.id.endsWith('-garam-50'))
    .map(p => ({ ...p, priceCents: 0 }))
  const candidate = basket(m3CandidateStore, withoutSpice)
  assertElevenDemand(baseline)
  assert.equal(candidate.lines.length, 11)
  assert.equal(candidate.unresolvedLineCount, 1)
  assert.ok(candidate.totalCents < baseline.totalCents)
  const budget = assessPlannerBudgetCents(candidate.totalCents, 35, candidate.unresolvedLineCount)
  assert.equal(budget.status, 'unknown')
  assert.equal(budget.reason, 'unresolved-products')
  assert.equal(budget.knownMinimumCents, candidate.totalCents)
  assert.equal('remainingCents' in budget, false)
  assert.equal('overBudget' in budget, false)
  const compared = compareFullBaskets({ baseline, candidate })
  assert.equal(compared.claimable, false)
  assert.equal(compared.outcome, 'unknown')
  assert.equal(compared.deltaCents, null)
  assert.equal(compared.savingsCents, null)
  assert.deepEqual(compared.lineDeltas, [])
})

test('product M2→M3: invalid week-budget values never coerce to money', () => {
  const baseline = basket(m3BaselineStore, m3BaselineProducts)
  for (const invalid of ['35', 35.001, NaN, Infinity, -1, null, {}]) {
    const a = assessPlannerBudgetCents(baseline.totalCents, invalid, 0)
    assert.equal(a.status, 'unknown')
    assert.equal(a.reason, 'invalid-input')
    assert.equal(a.budgetCents, null)
    assert.equal('remainingLabel' in a, false)
  }
})
