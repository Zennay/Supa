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

// Independent #1513 financial-claim boundary validation at almost +1ms,
// not just the already-proven +1ns examples in #1512/#1516. Synthetic,
// price-fake baskets used strictly for tests; no retailer field evidence.
function fixtureBasket(store, discount = 0) {
  const products = m2Products.map((product) => ({
    ...product,
    id: store.id + '-' + product.id,
    storeId: store.id,
    priceCents: product.priceCents + discount,
  }))
  products.push({
    id: store.id + '-synthetic-spice',
    storeId: store.id,
    name: 'Garam masala 50 g (QA fixture)',
    packAmount: 50,
    packUnit: 'g',
    available: true,
    priceCents: 139 + discount,
  })
  const basket = buildOneStoreBasket({
    store,
    products,
    plan: m2InitialPlan,
    activeDays: m2DefaultActiveDays,
    recipes: m2Recipes,
  })
  assert.equal(basket.matchedLineCount, 11)
  assert.equal(basket.unresolvedLineCount, 0)
  return basket
}

const baselineStore = { id: 'synthetic-plus', name: 'PLUS synthetic' }
const candidateStore = { id: 'synthetic-dekamarkt', name: 'DekaMarkt synthetic' }

function sampleStudy(first, second) {
  return {
    schemaVersion: 1,
    studyId: 'qa-m3-999999ns-overrun',
    participantKey: 'synthetic-participant-test',
    population: 'synthetic',
    region: 'synthetic',
    weekStart: '2026-10-19',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'synthetic-plus-evidence',
      observedAt: first,
      source: 'manual-cart',
      provenanceNote: 'SYNTHETIC - not observed store prices',
      basket: fixtureBasket(baselineStore),
    },
    candidate: {
      evidenceId: 'synthetic-dekamarkt-evidence',
      observedAt: second,
      source: 'manual-cart',
      provenanceNote: 'SYNTHETIC - not observed store prices',
      basket: fixtureBasket(candidateStore, -1),
    },
  }
}

function expectFailClosed(report) {
  assert.equal(report.claimable, false)
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.deltaCents, null)
  assert.equal(report.savingsCents, null)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.attribution.status, 'unknown')
  assert.equal(Object.hasOwn(report, 'participantKey'), false)
}

test('QA expected RED: financial report cannot quote +999999ns hidden beyond 24h at .777', () => {
  const study = sampleStudy(
    '2026-10-24T12:00:00.777000000Z',
    '2026-10-25T12:00:00.777999999Z',
  )
  assert.equal(Date.parse(study.candidate.observedAt) - Date.parse(study.baseline.observedAt), 86_400_000)
  expectFailClosed(buildObservedWeekReport(study))
})

test('QA expected RED: direct assessment and report reject near-1ms DST overrun', () => {
  const study = sampleStudy(
    '2026-10-24T14:00:00.500000000+02:00',
    '2026-10-25T13:00:00.500999999+01:00',
  )
  const assessed = assessWeeklyBasketStudy(study)
  assert.equal(assessed.claimable, false)
  assert.equal(assessed.comparison.claimable, false)
  assert.equal(assessed.comparison.outcome, 'unknown')
  assert.equal(assessed.comparison.savingsCents, null)
  assert.deepEqual(assessed.comparison.lineDeltas, [])
  expectFailClosed(buildObservedWeekReport(study))
})

test('QA positive: supported exact 24h at .777000000 preserves actual synthetic cent comparison', () => {
  const study = sampleStudy(
    '2026-10-24T12:00:00.777000000Z',
    '2026-10-25T12:00:00.777000000Z',
  )
  const report = buildObservedWeekReport(study)
  assert.equal(report.claimable, true)
  assert.equal(report.outcome, 'better')
  assert.equal(report.deltaCents, study.candidate.basket.totalCents - study.baseline.basket.totalCents)
  assert.equal(report.savingsCents, -report.deltaCents)
  assert.equal(report.publicSavingsClaimEligible, false)
})
