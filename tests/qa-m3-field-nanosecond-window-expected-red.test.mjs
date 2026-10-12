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

// Expected-RED independent QA for M3 *field observation* precision, NOT the
// separate private catalog freshness parser (#1148 / #1150).
// Date.parse truncates nonzero digits beyond milliseconds. A recorded +1ns
// beyond the strict 24h bound must never be treated as an exact 24h PASS.
// All basket prices/timestamps are synthetic test inputs, NOT retailer facts.
const stores = [
  { id: 'qa-precision-plus', name: 'PLUS synthetic shop' },
  { id: 'qa-precision-deka', name: 'DekaMarkt synthetic shop' },
]

function basket(store, offset = 0) {
  const products = m2Products.map((product) => ({
    ...product,
    id: `${store.id}-${product.id}`,
    storeId: store.id,
    priceCents: product.priceCents + offset,
  }))
  products.push({
    id: `${store.id}-garam`,
    storeId: store.id,
    name: 'Synthetic garam masala 50 g',
    packAmount: 50,
    packUnit: 'g',
    available: true,
    priceCents: 139 + offset,
  })
  const output = buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })
  assert.equal(output.unresolvedLineCount, 0)
  assert.equal(output.matchedLineCount, 11)
  return output
}

function study(baselineAt, candidateAt) {
  return {
    schemaVersion: 1,
    studyId: 'qa-m3-nanosecond-window',
    participantKey: 'synthetic-private-participant',
    population: 'Synthetic QA only',
    region: 'Leiden',
    weekStart: '2026-10-19',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'qa-baseline-precision',
      observedAt: baselineAt,
      source: 'manual-cart',
      provenanceNote: 'Synthetic fixture, not observed retailer prices',
      basket: basket(stores[0]),
    },
    candidate: {
      evidenceId: 'qa-candidate-precision',
      observedAt: candidateAt,
      source: 'manual-cart',
      provenanceNote: 'Synthetic fixture, not observed retailer prices',
      basket: basket(stores[1], -1),
    },
  }
}

function requireAbstention(value) {
  assert.equal(value.claimable, false)
  assert.equal(value.outcome, 'unknown')
  assert.equal(value.deltaCents, null)
  assert.equal(value.savingsCents, null)
}

test('EXPECTED RED: M3 assessment rejects 24h + 1ns rather than losing fractional precision', () => {
  const input = study(
    '2026-10-24T16:00:00.000000000Z',
    '2026-10-25T16:00:00.000000001Z',
  )
  const result = assessWeeklyBasketStudy(input)
  requireAbstention(result.comparison)
  assert.equal(result.claimable, false)
  assert.deepEqual(result.comparison.lineDeltas, [])
})

test('EXPECTED RED: M3 report must not quote a 24h + 1ns difference as claimable', () => {
  const input = study(
    '2026-10-24T16:00:00.000000000Z',
    '2026-10-25T16:00:00.000000001Z',
  )
  const report = buildObservedWeekReport(input)
  requireAbstention(report)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.attribution.status, 'unknown')
  assert.equal('participantKey' in report, false)
})

test('EXPECTED RED: M3 reversed side ordering also rejects 24h + 1ns', () => {
  const input = study(
    '2026-10-25T16:00:00.000000001Z',
    '2026-10-24T16:00:00.000000000Z',
  )
  const report = buildObservedWeekReport(input)
  requireAbstention(report)
  assert.equal(report.publicSavingsClaimEligible, false)
})

test('EXPECTED RED: M3 DST-offset 24h + 1ns must not collapse to exactly 24h', () => {
  const input = study(
    '2026-10-24T18:00:00.000000000+02:00',
    '2026-10-25T17:00:00.000000001+01:00',
  )
  const report = buildObservedWeekReport(input)
  requireAbstention(report)
  assert.equal(report.publicSavingsClaimEligible, false)
})

test('POSITIVE: exact-24h nine-digit trailing zeros retain valid exact-cent comparison', () => {
  const input = study(
    '2026-10-24T16:00:00.000000000Z',
    '2026-10-25T16:00:00.000000000Z',
  )
  const report = buildObservedWeekReport(input)
  assert.equal(report.claimable, true)
  assert.equal(report.observationWindowHours, 24)
  assert.equal(report.outcome, 'better')
  assert.equal(
    report.deltaCents,
    input.candidate.basket.totalCents - input.baseline.basket.totalCents,
  )
  assert.equal(report.savingsCents, -report.deltaCents)
  assert.equal(report.publicSavingsClaimEligible, false)
})

test('POSITIVE: supported millisecond cutoffs retain inclusive 24h and reject +1ms', () => {
  const accepted = buildObservedWeekReport(study(
    '2026-10-24T16:00:00.000Z',
    '2026-10-25T16:00:00.000Z',
  ))
  assert.equal(accepted.claimable, true)
  assert.equal(accepted.observationWindowHours, 24)
  assert.equal(accepted.outcome, 'better')

  const rejected = buildObservedWeekReport(study(
    '2026-10-24T16:00:00.000Z',
    '2026-10-25T16:00:00.001Z',
  ))
  requireAbstention(rejected)
  assert.equal(rejected.publicSavingsClaimEligible, false)
})
