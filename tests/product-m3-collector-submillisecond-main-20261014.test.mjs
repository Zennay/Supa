import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import {
  observationSheetReadiness,
  observationWindowSummary,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'
import { observationNextAction } from '../src/features/observation/observationNextStep.ts'

// Fully fictional 22-line M3 field sheet. The 2025 DST fold gives a true
// 24-hour absolute window while the displayed local clocks differ.
const first = '2025-10-26T02:30:00.000000000+02:00'
const exactEnd = '2025-10-27T01:30:00.000000000+01:00'
const reviewNow = Date.parse('2026-10-14T12:00:00Z')

function completedFieldSheet(baselineAt = first, candidateAt = exactEnd) {
  const sheet = buildFictionalPricedSheet(90)
  sheet.study.weekStart = '2025-10-27'
  sheet.baseline.observedAt = baselineAt
  sheet.candidate.observedAt = candidateAt
  return sheet
}

test('collector preserves valid exactly 24-hour DST field draft with zero fractional tails', () => {
  const sheet = completedFieldSheet()
  const original = JSON.stringify(sheet)
  const summary = observationWindowSummary(sheet, reviewNow)
  assert.equal(summary.state, 'within-window')
  assert.equal(observationSheetReadiness(sheet, reviewNow).ready, true)
  assert.equal(observationNextAction(sheet, reviewNow).stage, 'export')
  assert.equal(JSON.stringify(sheet), original, 'readiness never mutates field evidence')
})

test('collector refuses hidden nanosecond and microsecond precision from either observed store', () => {
  const cases = [
    [first, '2025-10-27T01:30:00.000000001+01:00'],
    [first, '2025-10-27T01:30:00.000900000+01:00'],
    [first, '2025-10-27T01:30:00.0001+01:00'],
    ['2025-10-26T02:30:00.000000001+02:00', exactEnd],
    ['2025-10-26T02:30:00.000900000+02:00', exactEnd],
  ]
  for (const [baselineAt, candidateAt] of cases) {
    const sheet = completedFieldSheet(baselineAt, candidateAt)
    const bytes = JSON.stringify(sheet)
    const restored = restoreObservationSheetDraft(bytes)
    assert.ok(restored !== null, 'local draft restoration must preserve original bytes')
    for (const example of [sheet, restored]) {
      assert.equal(observationSheetReadiness(example, reviewNow).ready, false,
        'ambiguous clock cannot approve a real field study')
      assert.notEqual(observationWindowSummary(example, reviewNow).state, 'within-window',
        'hidden nanoseconds cannot become exactly 24h')
      assert.notEqual(observationNextAction(example, reviewNow).stage, 'export',
        'the operator must not be offered export')
    }
    assert.equal(JSON.stringify(sheet), bytes, 'raw observations stay immutable')
  }
})

test('extra zero precision and valid millisecond clocks stay export-ready', () => {
  for (const end of [
    exactEnd,
    '2025-10-27T01:30:00.000+01:00',
    '2025-10-27T01:29:59.999+01:00',
  ]) {
    const sheet = completedFieldSheet(first, end)
    assert.equal(observationSheetReadiness(sheet, reviewNow).ready, true)
    assert.equal(observationNextAction(sheet, reviewNow).stage, 'export')
  }
})
