import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

const SIDES = [
  { id: 'synthetic-plus', name: 'PLUS controlled synthetic QA' },
  { id: 'synthetic-dekamarkt', name: 'DekaMarkt controlled synthetic QA' },
]

function controlledBasket(store, discount) {
  const products = [
    ...m2Products.map((product) => ({
      ...product,
      id: `${store.id}-${product.id}`,
      storeId: store.id,
      priceCents: product.priceCents - discount,
    })),
    {
      id: `${store.id}-garam`,
      storeId: store.id,
      name: 'Controlled garam masala 50g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 - discount,
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

function controlledStudy(baseTime, candidateTime) {
  return {
    schemaVersion: 1,
    studyId: 'synthetic-nanos-001',
    participantKey: 'student-synthetic-qa',
    population: 'controlled synthetic QA only',
    region: 'controlled test region',
    weekStart: '2026-10-19',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'synthetic-plus-001',
      observedAt: baseTime,
      source: 'manual-cart',
      provenanceNote: 'NOT an actual PLUS visit; no observed prices.',
      basket: controlledBasket(SIDES[0], 0),
    },
    candidate: {
      evidenceId: 'synthetic-dekamarkt-001',
      observedAt: candidateTime,
      source: 'manual-cart',
      provenanceNote: 'NOT an actual DekaMarkt visit; no observed prices.',
      basket: controlledBasket(SIDES[1], 10),
    },
  }
}

test('M3 complete report refuses 24h + 1ns even with complete synthetic basket prices', () => {
  const first = '2026-10-24T16:00:00.000000000Z'
  const outside = '2026-10-25T16:00:00.000000001Z'

  for (const [baseline, candidate] of [[first, outside], [outside, first]]) {
    const report = buildObservedWeekReport(controlledStudy(baseline, candidate))
    assert.equal(report.claimable, false)
    assert.equal(report.outcome, 'unknown')
    assert.equal(report.deltaCents, null)
    assert.equal(report.savingsCents, null)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.attribution.status, 'unknown')
    assert.equal('participantKey' in report, false)
    assert.match(report.reasons.join(' '), /exact nanosecond limit exceeded/)
  }
})

test('M3 complete report retains equal-boundary, within-window and private-only money controls', () => {
  const start = '2026-10-24T16:00:00.000000000Z'
  for (const within of [
    '2026-10-25T15:59:59.999999999Z',
    '2026-10-25T16:00:00.000000000Z',
  ]) {
    const report = buildObservedWeekReport(controlledStudy(start, within))
    assert.equal(report.claimable, true)
    assert.equal(report.outcome, 'better')
    assert.ok(report.savingsCents > 0)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal('participantKey' in report, false)
  }
})
