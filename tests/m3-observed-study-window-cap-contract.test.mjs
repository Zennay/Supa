import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
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

// Controlled baskets are regression fixtures, never observed retailer evidence.
function controlledStudy(candidateObservedAt) {
  const commonBasket = {
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
  }

  return {
    schemaVersion: 1,
    studyId: 'window-contract-001',
    participantKey: 'student-window-test',
    population: 'controlled regression fixture',
    region: 'fixture-only',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'window-baseline-001',
      observedAt: '2026-10-02T10:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic regression fixture; not an actual PLUS observation.',
      basket: buildOneStoreBasket({
        ...commonBasket,
        store: m3BaselineStore,
        products: m3BaselineProducts,
      }),
    },
    candidate: {
      evidenceId: 'window-candidate-001',
      observedAt: candidateObservedAt,
      source: 'manual-cart',
      provenanceNote: 'Synthetic regression fixture; not an actual DekaMarkt observation.',
      basket: buildOneStoreBasket({
        ...commonBasket,
        store: m3CandidateStore,
        products: m3CandidateProducts,
      }),
    },
  }
}

test('M3 rejects 48h override even when a 25h pair would otherwise compare', () => {
  const assessment = assessWeeklyBasketStudy(
    controlledStudy('2026-10-03T11:00:00Z'),
    { maxObservationWindowHours: 48 },
  )

  assert.equal(assessment.claimable, false)
  assert.equal(assessment.observationWindowHours, 25)
  assert.equal(assessment.comparison.outcome, 'unknown')
  assert.equal(assessment.comparison.savingsCents, null)
  assert.deepEqual(assessment.comparison.lineDeltas, [])
  assert.match(assessment.reasons.join(' '), /maxObservationWindowHours.*no greater than 24/)
})

test('M3 disallows oversized override even for a pair already inside 24h', () => {
  const assessment = assessWeeklyBasketStudy(
    controlledStudy('2026-10-02T11:00:00Z'),
    { maxObservationWindowHours: 25 },
  )

  assert.equal(assessment.claimable, false)
  assert.equal(assessment.comparison.outcome, 'unknown')
  assert.match(assessment.reasons.join(' '), /no greater than 24/)
})

test('M3 preserves explicit 24h boundary for complete controlled baskets', () => {
  const assessment = assessWeeklyBasketStudy(
    controlledStudy('2026-10-03T10:00:00Z'),
    { maxObservationWindowHours: 24 },
  )

  assert.equal(assessment.observationWindowHours, 24)
  assert.equal(assessment.claimable, true)
  assert.equal(assessment.comparison.outcome, 'better')
})

test('M3 permits stricter configured windows but still rejects late evidence', () => {
  const assessment = assessWeeklyBasketStudy(
    controlledStudy('2026-10-02T23:00:00Z'),
    { maxObservationWindowHours: 12 },
  )

  assert.equal(assessment.observationWindowHours, 13)
  assert.equal(assessment.claimable, false)
  assert.equal(assessment.comparison.outcome, 'unknown')
  assert.match(assessment.reasons.join(' '), /max is 12h/)
})


test('M3 cannot claim a mathematically neutral empty observed week', () => {
  const value = controlledStudy('2026-10-02T11:00:00Z')
  for (const side of ['baseline', 'candidate']) {
    value[side].basket = {
      ...value[side].basket,
      selectedMealCount: 0,
      lines: [],
      matchedLineCount: 0,
      unresolvedLineCount: 0,
      totalCents: 0,
    }
  }

  const assessment = assessWeeklyBasketStudy(value)

  assert.equal(assessment.claimable, false)
  assert.equal(assessment.comparison.outcome, 'unknown')
  assert.equal(assessment.comparison.deltaCents, null)
  assert.equal(assessment.comparison.savingsCents, null)
  assert.deepEqual(assessment.comparison.lineDeltas, [])
  assert.match(assessment.reasons.join(' '), /at least one selected meal/)
  assert.match(assessment.reasons.join(' '), /at least one ingredient line/)
})

test('M3 cannot claim a populated basket whose meal count is zero', () => {
  const value = controlledStudy('2026-10-02T11:00:00Z')
  value.baseline.basket.selectedMealCount = 0
  value.candidate.basket.selectedMealCount = 0

  const assessment = assessWeeklyBasketStudy(value)

  assert.equal(assessment.claimable, false)
  assert.equal(assessment.comparison.outcome, 'unknown')
  assert.equal(assessment.comparison.savingsCents, null)
  assert.match(assessment.reasons.join(' '), /at least one selected meal/)
})


test('M3 rejects an explicitly null assessment window instead of treating it as omitted', () => {
  const assessment = assessWeeklyBasketStudy(
    controlledStudy('2026-10-02T11:00:00Z'),
    { maxObservationWindowHours: null },
  )

  assert.equal(assessment.claimable, false)
  assert.equal(assessment.comparison.outcome, 'unknown')
  assert.equal(assessment.comparison.savingsCents, null)
  assert.match(assessment.reasons.join(' '), /maxObservationWindowHours/)
})

test('M3 preserves the canonical default for an omitted window override', () => {
  const assessment = assessWeeklyBasketStudy(
    controlledStudy('2026-10-03T10:00:00Z'),
    {},
  )

  assert.equal(assessment.observationWindowHours, 24)
  assert.equal(assessment.claimable, true)
  assert.equal(assessment.comparison.outcome, 'better')
})
