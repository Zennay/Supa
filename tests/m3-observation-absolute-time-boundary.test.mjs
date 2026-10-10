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

// All retailer/product data below are controlled fixtures, never field observations.
const baselineStore = { id: 'plus-utc-window', name: 'PLUS synthetic testfiliaal' }
const candidateStore = { id: 'dekamarkt-utc-window', name: 'DekaMarkt synthetic testfiliaal' }

function basket(store, priceDelta = 0) {
  const products = [
    ...m2Products.map((product) => ({
      ...product,
      id: `${store.id}-${product.id}`,
      storeId: store.id,
      priceCents: product.priceCents + priceDelta,
    })),
    {
      id: `${store.id}-garam-50`,
      storeId: store.id,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + priceDelta,
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

function study(baselineAt, candidateAt) {
  return {
    schemaVersion: 1,
    studyId: 'synthetic-absolute-window',
    participantKey: 'synthetic-student',
    population: 'independently living students',
    region: 'Leiden',
    weekStart: '2026-10-19',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'synthetic-plus-proof',
      observedAt: baselineAt,
      source: 'manual-cart',
      provenanceNote: 'Controlled timezone regression fixture; not a real receipt.',
      basket: basket(baselineStore),
    },
    candidate: {
      evidenceId: 'synthetic-deka-proof',
      observedAt: candidateAt,
      source: 'manual-cart',
      provenanceNote: 'Controlled timezone regression fixture; not a real receipt.',
      basket: basket(candidateStore, -10),
    },
  }
}

function assertUnknownAtWindowBoundary(result) {
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.deltaCents, null)
  assert.equal(result.comparison.savingsCents, null)
  assert.deepEqual(result.comparison.lineDeltas, [])
  assert.match(result.reasons.join(' '), /max is 24h/)
}

test('M3 exactly-24h observations remain eligible across winter-time offset change', () => {
  // The first observation is 2026-10-25 00:30Z; the second is
  // 2026-10-26 00:30Z, even though the local wall clocks differ by 23h.
  const value = study(
    '2026-10-25T02:30:00+02:00',
    '2026-10-26T01:30:00+01:00',
  )
  const result = assessWeeklyBasketStudy(value)
  assert.equal(result.observationWindowHours, 24)
  assert.equal(result.claimable, true)
  assert.equal(result.comparison.outcome, 'better')
  assert.ok(result.comparison.savingsCents > 0)
  assert.deepEqual(result.reasons, [])

  const report = buildObservedWeekReport(value)
  assert.equal(report.observationWindowHours, 24)
  assert.equal(report.claimable, true)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal('participantKey' in report, false)
})

test('M3 observations 1ms beyond 24h fail closed even across different offsets', () => {
  const result = assessWeeklyBasketStudy(
    study(
      '2026-10-25T02:30:00+02:00',
      '2026-10-26T01:30:00.001+01:00',
    ),
  )
  assert.ok(result.observationWindowHours > 24)
  assertUnknownAtWindowBoundary(result)
})

test('M3 checks actual instants, not wall-clock strings, during the DST fold', () => {
  const cases = [
    // Both describe the same instant.
    ['2026-10-25T02:30:00+02:00', '2026-10-25T01:30:00+01:00', 0],
    // The duplicated 02:30 local time describes instants one hour apart.
    ['2026-10-25T02:30:00+02:00', '2026-10-25T02:30:00+01:00', 1],
    // Same absolute distance, reversed observation order.
    ['2026-10-26T01:30:00+01:00', '2026-10-25T02:30:00+02:00', 24],
    // Month boundary must not be read as a 24-hour change in the day number.
    ['2026-10-31T23:30:00Z', '2026-11-01T00:15:00Z', 0.75],
  ]

  for (const [baselineAt, candidateAt, expectedHours] of cases) {
    const result = assessWeeklyBasketStudy(study(baselineAt, candidateAt))
    assert.equal(result.observationWindowHours, expectedHours, `${baselineAt} -> ${candidateAt}`)
    assert.equal(result.claimable, true, `${baselineAt} -> ${candidateAt}: ${result.reasons}`)
    assert.equal(result.comparison.outcome, 'better')
    assert.deepEqual(result.reasons, [])
  }
})

test('M3 absolute time window rejects distant but deceptively similar local times', () => {
  const cases = [
    // Same clock display one day later, but an extra hour in UTC.
    ['2026-10-25T02:30:00+02:00', '2026-10-26T02:30:00+01:00'],
    // Reverse direction is also out of scope.
    ['2026-10-26T02:30:00+01:00', '2026-10-25T02:30:00+02:00'],
  ]

  for (const [baselineAt, candidateAt] of cases) {
    const result = assessWeeklyBasketStudy(study(baselineAt, candidateAt))
    assert.equal(result.observationWindowHours, 25)
    assertUnknownAtWindowBoundary(result)
    const report = buildObservedWeekReport(study(baselineAt, candidateAt))
    assert.equal(report.claimable, false)
    assert.equal(report.outcome, 'unknown')
    assert.equal(report.savingsCents, null)
    assert.equal(report.publicSavingsClaimEligible, false)
  }
})

test('M3 rejects invalid timezone/date fields without inferring a savings outcome', () => {
  const invalidTimes = [
    '2026-10-25T02:30:00', // missing explicit timezone
    '2026-10-25T02:30:00+25:00',
    '2026-10-25T02:30:00+01:60',
    '2026-10-25T02:30:60Z',
    '2026-02-30T02:30:00Z',
    '2026-10-25',
  ]

  for (const timestamp of invalidTimes) {
    for (const side of ['baseline', 'candidate']) {
      const value = study('2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z')
      value[side].observedAt = timestamp
      const result = assessWeeklyBasketStudy(value)
      assert.equal(result.claimable, false, `${side} ${timestamp}`)
      assert.equal(result.observationWindowHours, null)
      assert.equal(result.comparison.outcome, 'unknown')
      assert.equal(result.comparison.savingsCents, null)
      assert.match(result.reasons.join(' '), new RegExp(`${side} observedAt is not a valid timestamp`))
    }
  }
})
