import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { observationSheetReadiness, observationWindowSummary } from '../src/domain/m3ObservationSheet.ts'
import { observationNextAction } from '../src/features/observation/observationNextStep.ts'

const reviewClock = Date.parse('2026-10-14T12:00:00Z')
const start = '2025-10-26T02:30:00.000000000+02:00'

function fictionalCompletedForm(end) {
  const sheet = buildFictionalPricedSheet(90)
  sheet.study.weekStart = '2025-10-27'
  sheet.baseline.observedAt = start
  sheet.candidate.observedAt = end
  return sheet
}

for (const [label, end] of [
  ['one nanosecond', '2025-10-27T01:30:00.000000001+01:00'],
  ['900 microseconds', '2025-10-27T01:30:00.000900000+01:00'],
]) {
  test(`M3 collector must not offer export for 24h plus ${label} with 22 fictional complete rows`, () => {
    const sheet = fictionalCompletedForm(end)
    const before = JSON.stringify(sheet)
    assert.equal(observationWindowSummary(sheet, reviewClock).state, 'outside-window')
    assert.equal(observationSheetReadiness(sheet, reviewClock).ready, false)
    assert.notEqual(observationNextAction(sheet, reviewClock).stage, 'export')
    assert.equal(JSON.stringify(sheet), before, 'QA checks must not manufacture field evidence')
  })
}

test('M3 collector should continue to offer draft export only for exactly 24h in 22 fictional complete rows', () => {
  const sheet = fictionalCompletedForm('2025-10-27T01:30:00.000000000+01:00')
  assert.equal(observationWindowSummary(sheet, reviewClock).state, 'within-window')
  assert.equal(observationSheetReadiness(sheet, reviewClock).ready, true)
  assert.equal(observationNextAction(sheet, reviewClock).stage, 'export')
})
