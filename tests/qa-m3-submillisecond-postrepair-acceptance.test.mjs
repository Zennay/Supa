import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts, m3BaselineStore,
  m3CandidateProducts, m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

// Separate postrepair acceptance. This is synthetic QA, never a real PLUS
// or DekaMarkt observation, retailer source authorization or savings proof.
const baselineBasket = buildOneStoreBasket({
  store: { ...m3BaselineStore, name: 'PLUS synthetic test store' },
  plan: m2InitialPlan, recipes: m2Recipes,
  activeDays: m2DefaultActiveDays, products: m3BaselineProducts,
})
const candidateBasket = buildOneStoreBasket({
  store: { ...m3CandidateStore, name: 'DekaMarkt synthetic test store' },
  plan: m2InitialPlan, recipes: m2Recipes,
  activeDays: m2DefaultActiveDays, products: m3CandidateProducts,
})

assert.equal(baselineBasket.unresolvedLineCount, 0)
assert.equal(candidateBasket.unresolvedLineCount, 0)

function observedStudy(baselineAt, candidateAt) {
  return {
    schemaVersion: 1,
    studyId: 'm3-qa-submillisecond-acceptance',
    participantKey: 'synthetic-pseudonym-001',
    population: 'synthetic fixture only',
    region: 'synthetic area',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'synthetic-baseline-001',
      observedAt: baselineAt,
      source: 'manual-cart',
      provenanceNote: 'QA synthetic; not observed prices',
      basket: baselineBasket,
    },
    candidate: {
      evidenceId: 'synthetic-candidate-001',
      observedAt: candidateAt,
      source: 'manual-cart',
      provenanceNote: 'QA synthetic; not observed prices',
      basket: candidateBasket,
    },
  }
}

function expectUnknown(result) {
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.deltaCents, null)
  assert.equal(result.comparison.savingsCents, null)
  assert.deepEqual(result.comparison.lineDeltas, [])
  assert.equal(result.observationWindowHours, null)
}

for (const [label, first, second, invalidSide] of [
  ['fourth digit on baseline, well within window',
    '2026-10-08T09:00:00.1231Z', '2026-10-08T10:00:00.123Z', 'baseline'],
  ['ninth digit on candidate, well within window',
    '2026-10-08T09:00:00.123Z', '2026-10-08T10:00:00.123000001Z', 'candidate'],
  ['sixth digit on both, no interval overrun',
    '2026-10-08T09:00:00.000001Z', '2026-10-08T09:30:00.000001Z', 'both'],
  ['UTC-offset observation uses nonzero submillisecond',
    '2026-10-25T01:00:00.000000001+02:00',
    '2026-10-25T01:15:00.000000000+01:00', 'baseline'],
]) {
  test('M3 postrepair abstains on ' + label, () => {
    const study = observedStudy(first, second)
    const result = assessWeeklyBasketStudy(study)
    expectUnknown(result)
    if (invalidSide === 'both') {
      assert.ok(result.reasons.some(reason => reason.includes('baseline observedAt')))
      assert.ok(result.reasons.some(reason => reason.includes('candidate observedAt')))
    } else {
      assert.ok(result.reasons.some(reason => reason.includes(invalidSide + ' observedAt')))
    }

    const report = buildObservedWeekReport(study)
    assert.equal(report.claimable, false)
    assert.equal(report.outcome, 'unknown')
    assert.equal(report.deltaCents, null)
    assert.equal(report.savingsCents, null)
    assert.equal(report.observationWindowHours, null)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(Object.hasOwn(report, 'participantKey'), false)
  })
}

for (const [label, first, second] of [
  ['millisecond + exact 24h',
    '2026-10-08T09:00:00.123Z', '2026-10-09T09:00:00.123Z'],
  ['six trailing zeros keep millisecond exactness',
    '2026-10-08T09:00:00.123000000Z', '2026-10-09T09:00:00.123000000Z'],
  ['DST/offset preserved when fractional tail is zero',
    '2026-10-24T16:00:00.000000000+02:00',
    '2026-10-25T15:00:00.000000000+01:00'],
]) {
  test('M3 postrepair preserves ' + label, () => {
    const study = observedStudy(first, second)
    const result = assessWeeklyBasketStudy(study)
    assert.equal(result.claimable, true)
    assert.deepEqual(result.reasons, [])
    const report = buildObservedWeekReport(study)
    assert.equal(report.claimable, true)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(Object.hasOwn(report, 'participantKey'), false)
  })
}
