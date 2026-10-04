import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateObservedWeekEvidence } from '../scripts/m3-validate-observed-week.mjs'

const fingerprint = `sha256:${'a'.repeat(64)}`

function observedWeek(overrides = {}) {
  const document = {
    version: 1,
    milestone: 'M3 Full-basket comparison & savings proof',
    evidenceType: 'observed_week',
    studyId: 'm3-week-001',
    weekStart: '2026-09-28',
    region: 'Leiden',
    plan: {
      fingerprint,
      selectedMealCount: 4,
      recipeIds: ['tikka', 'teriyaki', 'pasta', 'tikka'],
    },
    baskets: [
      {
        role: 'baseline',
        storeId: 'store-a',
        storeName: 'Store A',
        observationMethod: 'manual_price_observation',
        planFingerprint: fingerprint,
        observedAt: '2026-10-02T17:00:00Z',
        sourceRef: 'observation:week-001:baseline',
        totalCents: 5000,
        matchedLineCount: 11,
        unresolvedIngredientIds: [],
        complete: true,
      },
      {
        role: 'candidate',
        storeId: 'store-b',
        storeName: 'Store B',
        observationMethod: 'receipt',
        planFingerprint: fingerprint,
        observedAt: '2026-10-02T18:00:00Z',
        sourceRef: 'receipt:week-001:candidate',
        totalCents: 4500,
        matchedLineCount: 11,
        unresolvedIngredientIds: [],
        complete: true,
      },
    ],
    comparison: {
      claimable: true,
      direction: 'better',
      deltaCents: 500,
      reasons: [],
      effects: {
        packSizeCents: 200,
        offerCents: 100,
        planningCents: null,
        unexplainedCents: 200,
      },
    },
    publicSavingsClaimEligible: false,
  }

  return {
    ...document,
    ...overrides,
  }
}

test('M3 accepts a complete observed week while keeping public claim eligibility false', () => {
  const result = evaluateObservedWeekEvidence(observedWeek())

  assert.equal(result.claimable, true)
  assert.equal(result.direction, 'better')
  assert.equal(result.deltaCents, 500)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.stores.length, 2)
})

test('M3 preserves an observed worse outcome', () => {
  const document = observedWeek()
  document.baskets[1].totalCents = 5200
  document.comparison.direction = 'worse'
  document.comparison.deltaCents = -200
  document.comparison.effects = {
    packSizeCents: null,
    offerCents: null,
    planningCents: null,
    unexplainedCents: -200,
  }

  const result = evaluateObservedWeekEvidence(document)

  assert.equal(result.claimable, true)
  assert.equal(result.direction, 'worse')
  assert.equal(result.deltaCents, -200)
})

test('M3 accepts incomplete observations only as unknown with no financial delta', () => {
  const document = observedWeek()
  document.baskets[1].complete = false
  document.baskets[1].unresolvedIngredientIds = ['garam-masala']
  document.comparison = {
    claimable: false,
    direction: 'unknown',
    deltaCents: null,
    reasons: ['candidate basket is incomplete'],
    effects: {
      packSizeCents: null,
      offerCents: null,
      planningCents: null,
      unexplainedCents: null,
    },
  }

  const result = evaluateObservedWeekEvidence(document)

  assert.equal(result.claimable, false)
  assert.equal(result.direction, 'unknown')
  assert.equal(result.deltaCents, null)
})

test('M3 rejects controlled fixtures masquerading as observed evidence', () => {
  const document = observedWeek()
  document.baskets[1].observationMethod = 'controlled_fixture'

  assert.throws(
    () => evaluateObservedWeekEvidence(document),
    /observationMethod must be an observed-data method/,
  )
})

test('M3 rejects a single observed week being marked eligible for a public savings claim', () => {
  const document = observedWeek({ publicSavingsClaimEligible: true })

  assert.throws(
    () => evaluateObservedWeekEvidence(document),
    /single observed-week record can never be marked publicSavingsClaimEligible/,
  )
})

test('M3 rejects comparison math that does not reconcile to observed totals', () => {
  const document = observedWeek()
  document.comparison.deltaCents = 499

  assert.throws(
    () => evaluateObservedWeekEvidence(document),
    /deltaCents must equal baseline total minus candidate total/,
  )
})

test('M3 rejects observations outside the declared week', () => {
  const document = observedWeek()
  document.baskets[0].observedAt = '2026-10-05T00:00:00Z'

  assert.throws(
    () => evaluateObservedWeekEvidence(document),
    /observation must fall inside the declared week/,
  )
})
