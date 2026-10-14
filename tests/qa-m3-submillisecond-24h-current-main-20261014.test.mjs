import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

// Independent, intentionally synthetic quality-validation for #1513.
// None of these prices, evidence IDs or retailers constitute field observations.
function fictionalBasket(side, discountCents = 0) {
  const store = side === 'baseline'
    ? { id: 'qa-plus-subms', name: 'PLUS fictional fixture' }
    : { id: 'qa-dekamarkt-subms', name: 'DekaMarkt fictional fixture' }
  const products = [
    ...m2Products.map((product) => ({
      ...product,
      id: `${store.id}-${product.id}`,
      storeId: store.id,
      priceCents: product.priceCents - discountCents,
    })),
    {
      id: `${store.id}-spice`,
      storeId: store.id,
      name: 'Fictional masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 - discountCents,
    },
  ]
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })
}

function fictionalStudy(baselineAt, candidateAt) {
  // October 26–27 2025 belong to the legal Oct 27 shopping/week window.
  return {
    schemaVersion: 1,
    studyId: 'qa-submillisecond-boundary',
    participantKey: 'qa-pseudonym-only',
    population: 'fictional independent students',
    region: 'fictional Leiden',
    weekStart: '2025-10-27',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'qa-plus-subms-evidence',
      observedAt: baselineAt,
      source: 'manual-cart',
      provenanceNote: 'Synthetic precision fixture; not a receipt.',
      basket: fictionalBasket('baseline'),
    },
    candidate: {
      evidenceId: 'qa-deka-subms-evidence',
      observedAt: candidateAt,
      source: 'manual-cart',
      provenanceNote: 'Synthetic precision fixture; not a receipt.',
      basket: fictionalBasket('candidate', 10),
    },
  }
}

const exactly24h = [
  '2025-10-26T02:30:00.000000000+02:00',
  '2025-10-27T01:30:00.000000000+01:00',
]

function assertConservative(result, label) {
  assert.equal(result.claimable, false, `${label}: cannot claim a price outcome`)
  assert.equal(result.comparison.outcome, 'unknown', `${label}: unknown outcome`)
  assert.equal(result.comparison.savingsCents, null, `${label}: null savings`)
  assert.equal(result.comparison.deltaCents, null, `${label}: null delta`)
  assert.deepEqual(result.comparison.lineDeltas, [], `${label}: no asserted financial lines`)
}

test('M3 +1 nanosecond beyond 24h never yields a claimable comparison across DST', () => {
  const input = fictionalStudy(
    exactly24h[0],
    '2025-10-27T01:30:00.000000001+01:00',
  )
  assertConservative(assessWeeklyBasketStudy(input), 'DST +1ns')
  const report = buildObservedWeekReport(input)
  assert.equal(report.claimable, false)
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.savingsCents, null)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(Object.hasOwn(report, 'participantKey'), false)
})

test('M3 submillisecond precision does not disappear when baseline and candidate are reversed', () => {
  assertConservative(assessWeeklyBasketStudy(fictionalStudy(
    '2025-10-27T01:30:00.000000001+01:00',
    exactly24h[0],
  )), 'reversed +1ns')
})

test('M3 +900 microseconds beyond 24h is not rounded down', () => {
  assertConservative(assessWeeklyBasketStudy(fictionalStudy(
    exactly24h[0],
    '2025-10-27T01:30:00.000900000+01:00',
  )), '+900us')
})

test('M3 exact 24h with all-zero nanosecond padding remains admissible in a fully fictional control', () => {
  const result = assessWeeklyBasketStudy(fictionalStudy(...exactly24h))
  assert.equal(result.observationWindowHours, 24)
  assert.equal(result.claimable, true, result.reasons.join('; '))
  assert.equal(result.comparison.outcome, 'better')
  assert.ok(result.comparison.savingsCents > 0)
  const report = buildObservedWeekReport(fictionalStudy(...exactly24h))
  assert.equal(report.claimable, true)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(Object.hasOwn(report, 'participantKey'), false)
})

test('M3 genuine millisecond overrun remains rejected as a non-regression control', () => {
  assertConservative(assessWeeklyBasketStudy(fictionalStudy(
    exactly24h[0],
    '2025-10-27T01:30:00.001+01:00',
  )), '+1ms')
})
