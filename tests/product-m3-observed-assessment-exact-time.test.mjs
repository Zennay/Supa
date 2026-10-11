import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

function observedBasket(storeId, discount) {
  const products = [
    ...m2Products.map((product) => ({
      ...product,
      id: `${storeId}-${product.id}`,
      storeId,
      priceCents: product.priceCents - discount,
    })),
    {
      id: `${storeId}-garam`,
      storeId,
      name: 'Synthetic garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 - discount,
    },
  ]
  return buildOneStoreBasket({
    store: { id: storeId, name: `Synthetic ${storeId}` },
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })
}

function study(firstAt, lastAt) {
  return {
    schemaVersion: 1,
    studyId: 'synthetic-week-001',
    participantKey: 'student-qa-001',
    population: 'synthetic QA, not observed retail',
    region: 'synthetic test region',
    weekStart: '2026-10-19',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'synthetic-baseline-001',
      observedAt: firstAt,
      source: 'manual-cart',
      provenanceNote: 'Only controlled test input: NOT observed retail prices.',
      basket: observedBasket('synthetic-plus', 0),
    },
    candidate: {
      evidenceId: 'synthetic-candidate-001',
      observedAt: lastAt,
      source: 'manual-cart',
      provenanceNote: 'Only controlled test input: NOT observed retail prices.',
      basket: observedBasket('synthetic-deka', 10),
    },
  }
}

function assertUnknown(result) {
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.deltaCents, null)
  assert.equal(result.comparison.savingsCents, null)
  assert.deepEqual(result.comparison.lineDeltas, [])
  assert.match(result.reasons.join(' '), /exact nanosecond limit exceeded/)
}

test('M3 real assessment path never claims synthetic savings across 24h + 1ns', () => {
  const start = '2026-10-24T16:00:00.000000000Z'
  const after = '2026-10-25T16:00:00.000000001Z'

  assertUnknown(assessWeeklyBasketStudy(study(start, after)))
  assertUnknown(assessWeeklyBasketStudy(study(after, start)))
  assertUnknown(assessWeeklyBasketStudy(study(start, '2026-10-25T16:00:00.000999999Z')))
})

test('M3 exact boundary and 24h - 1ns keep legitimate controlled comparison behavior', () => {
  const start = '2026-10-24T16:00:00.000000000Z'
  for (const candidate of [
    '2026-10-25T16:00:00.000000000Z',
    '2026-10-25T15:59:59.999999999Z',
    '2026-10-25T16:00:00.000Z',
  ]) {
    const assessment = assessWeeklyBasketStudy(study(start, candidate))
    assert.equal(assessment.claimable, true)
    assert.equal(assessment.comparison.outcome, 'better')
    assert.ok(assessment.comparison.savingsCents > 0)
  }
})

test('M3 source assessment respects UTC offset, DST and configurable 15-minute window', () => {
  const first = '2026-03-29T01:30:00+01:00'
  const exact24 = '2026-03-30T02:30:00+02:00'
  const plus1 = '2026-03-30T02:30:00.000000001+02:00'
  assert.equal(assessWeeklyBasketStudy(study(first, exact24)).claimable, true)
  assertUnknown(assessWeeklyBasketStudy(study(first, plus1)))

  const shortFirst = '2026-10-24T16:00:00Z'
  assert.equal(
    assessWeeklyBasketStudy(study(shortFirst, '2026-10-24T16:15:00Z'), {
      maxObservationWindowHours: 0.25,
    }).claimable,
    true,
  )
  assertUnknown(
    assessWeeklyBasketStudy(study(shortFirst, '2026-10-24T16:15:00.000000001Z'), {
      maxObservationWindowHours: 0.25,
    }),
  )
})
