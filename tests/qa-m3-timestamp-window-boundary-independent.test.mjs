import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationSheetReadiness,
  observationWindowSummary,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'

// QA #1185: extra independent collector-to-converter time-window acceptance
// on frozen source fix #1188. 22 synthetic UNAVAILABLE product observations:
// these tests are not field evidence, retailer prices or a savings outcome.
function syntheticSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-window-matrix',
    participantKey: 'pseudonym-qa-only',
    population: 'synthetic user cohort',
    region: 'synthetic test region',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
  })
  for (const [side, id, name] of [
    ['baseline', 'plus-qa-window', 'PLUS synthetic-only'],
    ['candidate', 'deka-qa-window', 'DekaMarkt synthetic-only'],
  ]) {
    const entry = sheet[side]
    entry.evidenceId = side + '-qa-only'
    entry.store.id = id
    entry.store.name = name
    entry.source = 'manual-cart'
    entry.provenanceNote = 'Synthetic timestamp test; no store visit'
    for (const line of entry.lines) line.observedProduct.available = false
  }
  assert.equal(sheet.baseline.lines.length, 11)
  assert.equal(sheet.candidate.lines.length, 11)
  return sheet
}

function times(first, second) {
  const sheet = syntheticSheet()
  sheet.baseline.observedAt = first
  sheet.candidate.observedAt = second
  return sheet
}

test('QA #1185: exactly 24h inclusive across positive and negative UTC offsets', () => {
  for (const [first, second] of [
    ['2026-10-04T10:00:00+02:00', '2026-10-05T08:00:00Z'],
    ['2026-10-04T03:00:00-05:00', '2026-10-05T10:00:00+02:00'],
    ['2026-10-05T08:00:00Z', '2026-10-04T10:00:00+02:00'],
  ]) {
    const sheet = times(first, second)
    const readiness = observationSheetReadiness(sheet)
    assert.equal(readiness.ready, true, first + ' / ' + second + ': ' + readiness.issues.join('; '))
    assert.deepEqual(observationWindowSummary(sheet), {
      state: 'within-window', deltaHours: 24,
    })
    const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
    assert.equal(study.baseline.basket.unresolvedLineCount, 11)
    assert.equal(study.candidate.basket.unresolvedLineCount, 11)
    const restored = restoreObservationSheetDraft(JSON.stringify(sheet))
    assert.ok(restored)
    assert.equal(observationSheetReadiness(restored).ready, true)
    assert.deepEqual(observationWindowSummary(restored), {
      state: 'within-window', deltaHours: 24,
    })
  }
})

test('QA #1185: 24h + one millisecond reports outside, not a rounded pass', () => {
  const sheet = times('2026-10-04T10:00:00+02:00', '2026-10-05T08:00:00.001Z')
  assert.equal(observationSheetReadiness(sheet).ready, false)
  assert.ok(observationSheetReadiness(sheet).issues.some(
    (issue) => issue.includes('maximaal 24 uur'),
  ))
  const window = observationWindowSummary(sheet)
  assert.equal(window.state, 'outside-window')
  assert.ok(window.deltaHours > 24 && window.deltaHours < 24.000001)
  const restored = restoreObservationSheetDraft(JSON.stringify(sheet))
  assert.ok(restored)
  assert.equal(observationSheetReadiness(restored).ready, false)
  assert.equal(observationWindowSummary(restored).state, 'outside-window')
})

test('QA #1185: a valid candidate alongside invalid baseline cannot imply paired observation', () => {
  for (const invalid of [
    '2026-10-04T10:00:00', '2026-10-04', 'Sun, 04 Oct 2026 10:00:00 GMT',
    '2026-10-04T10:00:00+0200', '2026-10-04T10:00:00+24:00',
  ]) {
    const sheet = times(invalid, '2026-10-05T08:00:00Z')
    const status = observationSheetReadiness(sheet)
    assert.equal(status.ready, false)
    assert.ok(status.issues.some((issue) => /Winkel A.*observatietijd/.test(issue)))
    assert.ok(status.issues.every((issue) => !issue.includes(invalid)),
      'collector feedback must never echo raw time input')
    assert.deepEqual(observationWindowSummary(sheet), {
      state: 'single-observation',
      firstSide: 'candidate',
      firstObservedAt: '2026-10-05T08:00:00.000Z',
      deadlineAt: '2026-10-06T08:00:00.000Z',
    })
    assert.throws(
      () => buildWeeklyBasketStudyFromObservationSheet(sheet),
      /baseline\.observedAt must be a valid timestamp/,
    )
  }
})

test('QA #1185: a valid baseline alongside invalid candidate retains baseline deadline after draft reload', () => {
  const sheet = times('2026-10-04T10:00:00+02:00', '2026-10-05T08:00:00')
  const expected = {
    state: 'single-observation',
    firstSide: 'baseline',
    firstObservedAt: '2026-10-04T08:00:00.000Z',
    deadlineAt: '2026-10-05T08:00:00.000Z',
  }
  assert.deepEqual(observationWindowSummary(sheet), expected)
  assert.equal(observationSheetReadiness(sheet).ready, false)
  assert.throws(() => buildWeeklyBasketStudyFromObservationSheet(sheet),
    /candidate\.observedAt must be a valid timestamp/)
  const restored = restoreObservationSheetDraft(JSON.stringify(sheet))
  assert.ok(restored)
  assert.deepEqual(observationWindowSummary(restored), expected)
  assert.equal(observationSheetReadiness(restored).ready, false)
})
