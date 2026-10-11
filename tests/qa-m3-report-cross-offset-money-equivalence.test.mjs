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

function fixtureBasket(storeId, discount) {
  const products = [
    ...m2Products.map((product) => ({
      ...product,
      id: storeId + '-' + product.id,
      storeId,
      priceCents: product.priceCents - discount,
    })),
    {
      id: storeId + '-garam',
      storeId,
      name: 'Synthetic garam masala, not a store observation',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 - discount,
    },
  ]
  return buildOneStoreBasket({
    store: { id: storeId, name: storeId.includes('plus') ? 'Synthetic PLUS' : 'Synthetic DekaMarkt' },
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })
}

const baselineBasket = fixtureBasket('qa-plus-synthetic', 0)
const candidateBasket = fixtureBasket('qa-deka-synthetic', 10)

function study(baselineAt, candidateAt) {
  return {
    schemaVersion: 1,
    studyId: 'synthetic-offset-study',
    participantKey: 'synthetic-private-key',
    population: 'Synthetic QA only; no physical retailer visit',
    region: 'Synthetic region',
    weekStart: '2026-10-19',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'synthetic-plus-evidence',
      observedAt: baselineAt,
      source: 'manual-cart',
      provenanceNote: 'Controlled synthetic basket, not observed PLUS pricing',
      basket: baselineBasket,
    },
    candidate: {
      evidenceId: 'synthetic-deka-evidence',
      observedAt: candidateAt,
      source: 'manual-cart',
      provenanceNote: 'Controlled synthetic basket, not observed DekaMarkt pricing',
      basket: candidateBasket,
    },
  }
}

// Each string represents precisely the same UTC instant, independent of
// the offset text. No implementation helper computes these expected pairs.
const startClocks = [
  '2026-10-24T16:00:00.123456789Z',
  '2026-10-24T17:00:00.123456789+01:00',
  '2026-10-24T18:00:00.123456789+02:00',
  '2026-10-24T21:45:00.123456789+05:45',
  '2026-10-24T11:30:00.123456789-04:30',
]
const endClocks = [
  '2026-10-25T16:00:00.123456789Z',
  '2026-10-25T17:00:00.123456789+01:00',
  '2026-10-25T18:00:00.123456789+02:00',
  '2026-10-25T21:45:00.123456789+05:45',
  '2026-10-25T11:30:00.123456789-04:30',
]

test('QA M3 report: 25 equivalent timezone representations give identical private-only monetary output', () => {
  let expectedMoney = null
  for (const baselineAt of startClocks) {
    for (const candidateAt of endClocks) {
      const input = study(baselineAt, candidateAt)
      const result = assessWeeklyBasketStudy(input)
      const report = buildObservedWeekReport(input)
      assert.equal(result.claimable, true, baselineAt + ' / ' + candidateAt)
      assert.equal(result.comparison.outcome, 'better')
      assert.equal(report.claimable, true)
      assert.equal(report.outcome, 'better')
      assert.ok(report.savingsCents > 0)
      assert.equal(report.publicSavingsClaimEligible, false)
      assert.equal(Object.hasOwn(report, 'participantKey'), false)

      const money = [report.deltaCents, report.savingsCents]
      if (expectedMoney === null) expectedMoney = money
      else assert.deepEqual(money, expectedMoney, baselineAt + ' / ' + candidateAt)
    }
  }
})

test('QA M3 report: +1ns beyond 24h rejects all timezone equivalent start representations', () => {
  const justOutside = '2026-10-25T17:00:00.123456790+01:00'
  for (const baselineAt of startClocks) {
    for (const [first, second] of [[baselineAt, justOutside], [justOutside, baselineAt]]) {
      const input = study(first, second)
      const result = assessWeeklyBasketStudy(input)
      const report = buildObservedWeekReport(input)
      assert.equal(result.claimable, false)
      assert.equal(result.comparison.claimable, false)
      assert.equal(result.comparison.outcome, 'unknown')
      assert.equal(result.comparison.deltaCents, null)
      assert.equal(result.comparison.savingsCents, null)
      assert.deepEqual(result.comparison.lineDeltas, [])
      assert.equal(report.claimable, false)
      assert.equal(report.outcome, 'unknown')
      assert.equal(report.deltaCents, null)
      assert.equal(report.savingsCents, null)
      assert.equal(report.publicSavingsClaimEligible, false)
      assert.equal(Object.hasOwn(report, 'participantKey'), false)
      assert.match(report.reasons.join(' '), /exact nanosecond limit exceeded/)
    }
  }
})
