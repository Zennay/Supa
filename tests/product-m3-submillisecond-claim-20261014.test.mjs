import assert from 'node:assert/strict'
import test from 'node:test'

import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

// Synthetic timestamps, recipes and prices only. M3 #78 human field work is
// still necessary. October 2025 avoids future observation dates at runtime.
const baselineAt = '2025-10-26T02:30:00.000000000+02:00'
const exactly24h = '2025-10-27T01:30:00.000000000+01:00'
const overByOneNs = '2025-10-27T01:30:00.000000001+01:00'
const overByNineHundredUs = '2025-10-27T01:30:00.000900000+01:00'

function sheetFor(first, second) {
  const sheet = buildFictionalPricedSheet(90)
  sheet.study.weekStart = '2025-10-27'
  sheet.baseline.observedAt = first
  sheet.candidate.observedAt = second
  return sheet
}

test('canonical M3 converter preserves exact 24h DST-offset observation with trailing zeros', () => {
  const sheet = sheetFor(baselineAt, exactly24h)
  const before = JSON.stringify(sheet)
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const report = buildObservedWeekReport(study)
  assert.equal(JSON.stringify(sheet), before)
  assert.equal(report.observationWindowHours, 24)
  assert.equal(report.claimable, true)
  assert.equal(report.outcome, 'better')
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(Object.hasOwn(report, 'participantKey'), false)
})

test('M3 canonical JSON converter refuses nonzero submilliseconds on either evidence side', () => {
  for (const [first, second] of [
    [baselineAt, overByOneNs],
    [baselineAt, overByNineHundredUs],
    [overByOneNs, exactly24h],
    ['2025-10-26T02:30:00.000001+02:00', exactly24h],
  ]) {
    const sheet = sheetFor(first, second)
    const original = JSON.stringify(sheet)
    assert.throws(() => buildWeeklyBasketStudyFromObservationSheet(sheet),
      /observedAt must be a valid timestamp/,
      'converter should reject before producing a derived report')
    assert.equal(JSON.stringify(sheet), original,
      'failed preflight must not mutate original private observations')
  }
})

test('direct M3 financial assessor abstains for +1ns, +900us and inverted store clocks', () => {
  for (const [side, invalid] of [
    ['candidate', overByOneNs],
    ['candidate', overByNineHundredUs],
    ['baseline', '2025-10-26T02:30:00.000000001+02:00'],
    ['baseline', '2025-10-26T02:30:00.000900000+02:00'],
  ]) {
    const study = buildWeeklyBasketStudyFromObservationSheet(
      sheetFor(baselineAt, exactly24h),
    )
    study[side].observedAt = invalid
    const original = JSON.stringify(study)
    const assessment = assessWeeklyBasketStudy(study, {
      referenceNowMs: Date.parse('2026-10-14T00:00:00Z'),
    })
    assert.equal(assessment.claimable, false)
    assert.equal(assessment.comparison.outcome, 'unknown')
    assert.equal(assessment.comparison.deltaCents, null)
    assert.equal(assessment.comparison.savingsCents, null)
    assert.deepEqual(assessment.comparison.lineDeltas, [])
    assert.ok(assessment.reasons.some((reason) =>
      reason.includes('observedAt is not a valid timestamp')))
    const report = buildObservedWeekReport(study)
    assert.equal(report.claimable, false)
    assert.equal(report.outcome, 'unknown')
    assert.equal(report.deltaCents, null)
    assert.equal(report.savingsCents, null)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(Object.hasOwn(report, 'participantKey'), false)
    assert.equal(JSON.stringify(study), original)
  }
})

test('exact millisecond values and older historical fields stay valid and private', () => {
  for (const second of [
    '2025-10-27T01:29:59.999+01:00',
    '2025-10-27T01:30:00.000+01:00',
    exactly24h,
  ]) {
    const study = buildWeeklyBasketStudyFromObservationSheet(
      sheetFor(baselineAt, second),
    )
    const report = buildObservedWeekReport(study)
    assert.equal(report.claimable, true)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(Object.hasOwn(report, 'participantKey'), false)
  }
})
