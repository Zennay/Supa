import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import {
  observationSheetReadiness, observationWindowSummary,
} from '../src/domain/m3ObservationSheet.ts'
import { observationNextAction } from '../src/features/observation/observationNextStep.ts'

const clock = Date.parse('2026-10-14T12:00:00Z')
const badOffsets = ['+15:00', '-15:00', '+23:00', '+14:30', '-14:01', '+14:01', '-14:00', '-13:00', '-12:01']
const goodOffsets = ['+14:00', '-12:00', '+13:45', 'Z']

function clockedSheet(offset = 'Z') {
  const sheet = buildFictionalPricedSheet(90)
  sheet.baseline.observedAt = '2026-10-01T10:00:00' + offset
  sheet.candidate.observedAt = '2026-10-01T10:15:00' + offset
  return sheet
}

test('all M3 timestamp boundaries fail closed on non-physical UTC offsets on both retailer sides', () => {
  for (const offset of badOffsets) {
    for (const side of ['baseline', 'candidate']) {
      const sheet = clockedSheet()
      sheet[side].observedAt = '2026-10-01T10:00:00' + offset
      const before = JSON.stringify(sheet)
      const readiness = observationSheetReadiness(sheet, clock)
      assert.equal(readiness.ready, false, side + ' ' + offset)
      assert.notEqual(observationWindowSummary(sheet, clock).state, 'within-window')
      assert.notEqual(observationNextAction(sheet, clock).stage, 'export')
      assert.throws(() => buildWeeklyBasketStudyFromObservationSheet(sheet),
        /observedAt must be a valid timestamp/,
        'canonical JSON converter must refuse impossible offsets')
      assert.equal(JSON.stringify(sheet), before, 'no mutation of observations')

      const cleanStudy = buildWeeklyBasketStudyFromObservationSheet(clockedSheet())
      cleanStudy[side].observedAt = '2026-10-01T10:00:00' + offset
      const decision = assessWeeklyBasketStudy(cleanStudy, { referenceNowMs: clock })
      assert.equal(decision.claimable, false, side + ' ' + offset)
      assert.equal(decision.comparison.outcome, 'unknown')
      assert.equal(decision.comparison.deltaCents, null)
      assert.equal(decision.comparison.savingsCents, null)
      assert.deepEqual(decision.comparison.lineDeltas, [])
      assert.ok(decision.reasons.some(reason =>
        reason.includes('observedAt is not a valid timestamp')))
      const privateReport = buildObservedWeekReport(cleanStudy)
      assert.equal(privateReport.claimable, false)
      assert.equal(privateReport.outcome, 'unknown')
      assert.equal(privateReport.publicSavingsClaimEligible, false)
      assert.equal(Object.hasOwn(privateReport, 'participantKey'), false)
    }
  }
})

test('realistic and boundary UTC offsets preserve the complete 11+11 fictional field workflow', () => {
  for (const offset of goodOffsets) {
    const sheet = clockedSheet(offset)
    const original = JSON.stringify(sheet)
    assert.equal(observationSheetReadiness(sheet, clock).ready, true, offset)
    assert.equal(observationWindowSummary(sheet, clock).state, 'within-window', offset)
    assert.equal(observationNextAction(sheet, clock).stage, 'export', offset)
    const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
    const report = buildObservedWeekReport(study)
    assert.equal(report.claimable, true, offset)
    assert.equal(report.outcome, 'better')
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(JSON.stringify(sheet), original)
  }
})
