import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

// Independent #78 / M3 acceptance for the *24-hour inclusive boundary*.
// These controlled baskets and their timestamps are synthetic protocol inputs,
// not observed retailer prices or evidence of actual customer savings.
const baselineStore = { id: 'qa-plus-window', name: 'PLUS synthetic winkel' }
const candidateStore = { id: 'qa-deka-window', name: 'DekaMarkt synthetic winkel' }

function makeBasket(store, deltaCents) {
  const products = m2Products.map((product) => ({
    ...product,
    id: `${store.id}-${product.id}`,
    storeId: store.id,
    priceCents: product.priceCents + deltaCents,
  }))
  products.push({
    id: `${store.id}-garam`,
    storeId: store.id,
    name: 'Synthetic garam masala 50 g',
    packAmount: 50,
    packUnit: 'g',
    available: true,
    priceCents: 139 + deltaCents,
  })
  const basket = buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })
  assert.equal(basket.unresolvedLineCount, 0)
  assert.equal(basket.matchedLineCount, basket.lines.length)
  assert.ok(basket.lines.length >= 10)
  return basket
}

function syntheticStudy(baselineAt, candidateAt, candidateDelta = -1) {
  return {
    schemaVersion: 1,
    studyId: 'qa-window-inclusion-2026',
    participantKey: 'private-qa-participant',
    population: 'synthetic QA only',
    region: 'Leiden',
    weekStart: '2026-10-19',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'qa-plus-observation',
      observedAt: baselineAt,
      source: 'manual-cart',
      provenanceNote: 'Synthetic regression fixture, not a visit or actual price',
      basket: makeBasket(baselineStore, 0),
    },
    candidate: {
      evidenceId: 'qa-deka-observation',
      observedAt: candidateAt,
      source: 'manual-cart',
      provenanceNote: 'Synthetic regression fixture, not a visit or actual price',
      basket: makeBasket(candidateStore, candidateDelta),
    },
  }
}

function expectPrivateReport(report) {
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal('participantKey' in report, false)
  assert.doesNotMatch(JSON.stringify(report), /private-qa-participant/)
}

test('M3 inclusive exactly-24h window keeps complete synthetic basket decision', () => {
  const study = syntheticStudy(
    '2026-10-24T16:00:00Z',
    '2026-10-25T16:00:00Z',
  )
  const original = JSON.stringify(study)
  const report = buildObservedWeekReport(study)
  assert.equal(report.observationWindowHours, 24)
  assert.equal(report.claimable, true)
  assert.equal(report.outcome, 'better')
  assert.equal(report.deltaCents, study.candidate.basket.totalCents - study.baseline.basket.totalCents)
  assert.equal(report.savingsCents, -report.deltaCents)
  assert.deepEqual(report.reasons, [])
  assert.equal(JSON.stringify(study), original)
  expectPrivateReport(report)
})

test('M3 timezone offset and DST-day switch use elapsed UTC hours, not wall clock', () => {
  const study = syntheticStudy(
    '2026-10-24T18:00:00+02:00',
    '2026-10-25T17:00:00+01:00',
  )
  const report = buildObservedWeekReport(study)
  assert.equal(report.observationWindowHours, 24)
  assert.equal(report.claimable, true)
  assert.equal(report.outcome, 'better')
  expectPrivateReport(report)
})

test('M3 24h plus one millisecond abstains and never reveals a financial delta', () => {
  const study = syntheticStudy(
    '2026-10-24T16:00:00.000Z',
    '2026-10-25T16:00:00.001Z',
  )
  const report = buildObservedWeekReport(study)
  assert.ok(report.observationWindowHours > 24)
  assert.equal(report.claimable, false)
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.deltaCents, null)
  assert.equal(report.savingsCents, null)
  assert.equal(report.attribution.status, 'unknown')
  assert.match(report.reasons.join(' '), /max is 24h/)
  expectPrivateReport(report)
})

test('M3 one millisecond outside window abstains equally when retailer observation order reverses', () => {
  const study = syntheticStudy(
    '2026-10-25T16:00:00.001Z',
    '2026-10-24T16:00:00.000Z',
  )
  const report = buildObservedWeekReport(study)
  assert.ok(report.observationWindowHours > 24)
  assert.equal(report.claimable, false)
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.deltaCents, null)
  assert.equal(report.savingsCents, null)
  assert.deepEqual(report.attribution.effectTotals, {
    offerCents: 0,
    packSizeCents: 0,
    planningCents: 0,
    unknownCents: null,
  })
  expectPrivateReport(report)
})

test('M3 one millisecond inside window retains a worse result without hiding negative savings', () => {
  const study = syntheticStudy(
    '2026-10-24T16:00:00.000Z',
    '2026-10-25T15:59:59.999Z',
    1,
  )
  const report = buildObservedWeekReport(study)
  assert.ok(report.observationWindowHours < 24)
  assert.equal(report.claimable, true)
  assert.equal(report.outcome, 'worse')
  assert.equal(report.deltaCents, study.candidate.basket.totalCents - study.baseline.basket.totalCents)
  assert.ok(report.deltaCents > 0)
  assert.equal(report.savingsCents, -report.deltaCents)
  expectPrivateReport(report)
})

test('M3 equivalent UTC and time-offset instants preserve elapsed-window economics', () => {
  const utc = syntheticStudy('2026-10-24T16:00:00Z', '2026-10-25T15:00:00Z')
  const offset = syntheticStudy('2026-10-24T18:00:00+02:00', '2026-10-25T16:00:00+01:00')
  const a = buildObservedWeekReport(utc)
  const b = buildObservedWeekReport(offset)
  assert.equal(a.observationWindowHours, 23)
  assert.equal(b.observationWindowHours, 23)
  assert.equal(a.claimable, true)
  assert.equal(b.claimable, true)
  for (const field of ['outcome', 'baselineTotalCents', 'candidateTotalCents', 'deltaCents', 'savingsCents']) {
    assert.equal(a[field], b[field], field)
  }
  expectPrivateReport(a)
  expectPrivateReport(b)
})
