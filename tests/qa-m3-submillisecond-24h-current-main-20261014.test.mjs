import assert from 'node:assert/strict'
import test from 'node:test'

import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'

// Independent, intentionally synthetic quality-validation for #1513.
// Canonical full 11+11 fictional cohort avoids unrelated missing-pack matches.
function fictionalStudy(baselineAt, candidateAt) {
  const sheet = buildFictionalPricedSheet(90)
  sheet.study.weekStart = '2025-10-27'
  sheet.baseline.observedAt = baselineAt
  sheet.candidate.observedAt = candidateAt
  return buildWeeklyBasketStudyFromObservationSheet(sheet)
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
