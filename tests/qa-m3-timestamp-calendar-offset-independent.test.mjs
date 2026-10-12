import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationSheetReadiness,
  observationWindowSummary,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'

// Synthetic, all-unavailable product lines: never evidence of genuine retailer
// observations or price/savings outcomes. Independent exact-grammar assurance
// above frozen #1188 source, without editing the original source or tests.
function sheet() {
  const input = buildObservationSheet()
  Object.assign(input.study, {
    studyId: 'qa-timestamp-only',
    participantKey: 'anonymous-qa',
    population: 'synthetic-only',
    region: 'synthetic-Leiden',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
  })
  for (const [side, id, name, when] of [
    ['baseline', 'plus-qa', 'PLUS synthetic', '2026-10-04T12:00:00Z'],
    ['candidate', 'deka-qa', 'DekaMarkt synthetic', '2026-10-04T12:30:00Z'],
  ]) {
    const item = input[side]
    Object.assign(item, {
      evidenceId: side + '-id',
      observedAt: when,
      source: 'manual-cart',
      provenanceNote: 'Synthetic validation, no field observation',
      store: { id, name },
    })
    for (const line of item.lines) line.observedProduct.available = false
  }
  assert.equal(input.baseline.lines.length + input.candidate.lines.length, 22)
  return input
}
function checkInvalid(side, value) {
  const data = sheet()
  data[side].observedAt = value
  assert.throws(() => buildWeeklyBasketStudyFromObservationSheet(data), /observedAt must be a valid timestamp/)
  const readiness = observationSheetReadiness(data)
  assert.equal(readiness.ready, false, side + ' ' + value)
  assert.ok(readiness.issues.some(issue => /observatietijd/.test(issue)), value)
  assert.ok(readiness.issues.every(issue => !issue.includes(value)), 'no raw timestamp in issues')
  assert.notEqual(observationWindowSummary(data).state, 'within-window')
  const restored = restoreObservationSheetDraft(JSON.stringify(data))
  assert.ok(restored)
  assert.equal(observationSheetReadiness(restored).ready, false)
  assert.notEqual(observationWindowSummary(restored).state, 'within-window')
}

test('QA #1185 independent: collector and converter reject timezone suffix ambiguity and date-only input', () => {
  for (const invalid of [
    '2026-10-04', '2026-10-04T12:00:00',
    '2026-10-04T12:00:00+0200',
    '2026-10-04T12:00:00+02',
    'Sun, 04 Oct 2026 12:00:00 GMT',
    '2026-10-04T12:00:00Zjunk',
  ]) {
    for (const side of ['baseline', 'candidate']) checkInvalid(side, invalid)
  }
})

test('QA #1185 independent: reject calendar rollover and malformed 24h/60-minute clocks on both retailers', () => {
  for (const invalid of [
    '2026-02-29T12:00:00Z',
    '2026-02-31T12:00:00Z',
    '2026-04-31T12:00:00Z',
    '2026-10-04T24:00:00Z',
    '2026-10-04T12:60:00Z',
    '2026-10-04T12:00:60Z',
  ]) {
    for (const side of ['baseline', 'candidate']) checkInvalid(side, invalid)
  }
})

test('QA #1185 independent: canonical timezone-bearing pairs remain convertible but cannot prove savings', () => {
  for (const [baseline, candidate] of [
    ['2026-10-04T12:00:00Z', '2026-10-04T14:30:00+02:00'],
    ['2026-10-04T07:00:00-05:00', '2026-10-04T12:30:00Z'],
    ['2026-10-04T12:00:00.123Z', '2026-10-04T12:30:00.123Z'],
  ]) {
    const input = sheet()
    input.baseline.observedAt = baseline
    input.candidate.observedAt = candidate
    assert.equal(observationSheetReadiness(input).ready, true, baseline)
    assert.equal(observationWindowSummary(input).state, 'within-window', candidate)
    const converted = buildWeeklyBasketStudyFromObservationSheet(input)
    assert.equal(converted.baseline.basket.unresolvedLineCount, 11)
    assert.equal(converted.candidate.basket.unresolvedLineCount, 11)
    assert.notEqual(converted.baseline.observedAt, '')
  }
})

test('QA #1185 independent: two syntactically rejected timestamps cannot imply a completed window', () => {
  const input = sheet()
  input.baseline.observedAt = '2026-10-04T12:00:00'
  input.candidate.observedAt = '2026-10-04'
  assert.deepEqual(observationWindowSummary(input), { state: 'not-started' })
  assert.equal(observationSheetReadiness(input).ready, false)
  assert.throws(() => buildWeeklyBasketStudyFromObservationSheet(input), /observedAt/)
  const restored = restoreObservationSheetDraft(JSON.stringify(input))
  assert.ok(restored)
  assert.deepEqual(observationWindowSummary(restored), { state: 'not-started' })
})
