import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

// Synthetic 11 PLUS + 11 DekaMarkt canonical rows, NOT retailer/participant data.
// This probes the original canonical sheet -> converter -> report route, #1513.
const start = '2025-10-26T02:30:00.000000000+02:00'

function fullCanonicalReport(end) {
  const sheet = buildFictionalPricedSheet(90)
  sheet.study.weekStart = '2025-10-27'
  sheet.baseline.observedAt = start
  sheet.candidate.observedAt = end
  const original = JSON.stringify(sheet)
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  assert.equal(JSON.stringify(sheet), original, 'converter preserves fictional input')
  assert.equal(study.baseline.basket.matchedLineCount, 11)
  assert.equal(study.candidate.basket.matchedLineCount, 11)
  return buildObservedWeekReport(study)
}

test('fully priced fictional 11+11 converted observations must reject DST +1ns over 24h', () => {
  const report = fullCanonicalReport('2025-10-27T01:30:00.000000001+01:00')
  assert.equal(report.claimable, false)
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.savingsCents, null)
  assert.equal(report.deltaCents, null)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(Object.hasOwn(report, 'participantKey'), false)
})

test('fully priced fictional canonical report must reject +900us beyond 24h', () => {
  const report = fullCanonicalReport('2025-10-27T01:30:00.000900000+01:00')
  assert.equal(report.claimable, false)
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.savingsCents, null)
  assert.equal(report.publicSavingsClaimEligible, false)
})

test('exact 24h with nine zero fractional digits preserves private assessment without public claim', () => {
  const report = fullCanonicalReport('2025-10-27T01:30:00.000000000+01:00')
  assert.equal(report.claimable, true, report.reasons.join('; '))
  assert.equal(report.outcome, 'better')
  assert.equal(report.savingsCents, 110)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(Object.hasOwn(report, 'participantKey'), false)
})
