import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationSheetReadiness,
  observationWindowSummary,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'
import { observationNextAction } from '../src/features/observation/observationNextStep.ts'

// Independent test-only QA for #1081. All 22 lines are explicitly unavailable
// synthetic records: no visits, retailer prices, real savings or user details.
const REFERENCE_NOW = Date.parse('2026-10-13T12:00:00.000Z')
const BASELINE_AT = '2026-10-10T09:00:00.000Z'
const EXACT_24H = '2026-10-11T09:00:00.000Z'
const OVER_24H = '2026-10-11T10:00:00.000Z'

function fullyFictionalSheet(candidateAt = EXACT_24H) {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-immutable-window',
    participantKey: 'synthetic-student',
    population: 'fictional students',
    region: 'fictional region',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })
  for (const [side, store, at] of [
    ['baseline', 'PLUS synthetic location', BASELINE_AT],
    ['candidate', 'DekaMarkt synthetic location', candidateAt],
  ]) {
    Object.assign(sheet[side], {
      evidenceId: 'synthetic-' + side,
      observedAt: at,
      source: 'manual-cart',
      provenanceNote: 'Fictional unavailable rows only; not field evidence',
      store: { id: 'synthetic-' + side, name: store },
    })
    for (const line of sheet[side].lines) {
      line.observedProduct.available = false
    }
  }
  assert.equal(sheet.baseline.lines.length + sheet.candidate.lines.length, 22)
  return sheet
}

test('QA #1081 positive: canonical 24h pair is form-ready but never proved savings', () => {
  const sheet = fullyFictionalSheet()
  const before = JSON.stringify(sheet)
  assert.equal(observationWindowSummary(sheet, REFERENCE_NOW).state, 'within-window')
  assert.deepEqual(observationSheetReadiness(sheet, REFERENCE_NOW), { ready: true, issues: [] })
  const next = observationNextAction(sheet, REFERENCE_NOW)
  assert.equal(next.stage, 'export')
  assert.match(next.detail, /nog geen besparing/)
  assert.equal(JSON.stringify(sheet), before)
})

test('QA #1081: a forged 48h limit must not make a 25h pair form-ready', () => {
  const sheet = fullyFictionalSheet(OVER_24H)
  sheet.study.maxObservationWindowHours = 48
  const before = JSON.stringify(sheet)
  const readiness = observationSheetReadiness(sheet, REFERENCE_NOW)
  assert.equal(readiness.ready, false, '24h limit must be immutable even on mutated runtime input')
  assert.ok(readiness.issues.length > 0, 'explain why the 25h pair cannot be exported')
  assert.equal(JSON.stringify(sheet), before, 'validation must not mutate the draft')
})

test('QA #1081: a forged longer window never produces a within-window badge', () => {
  const sheet = fullyFictionalSheet(OVER_24H)
  sheet.study.maxObservationWindowHours = 48
  const before = JSON.stringify(sheet)
  assert.equal(
    observationWindowSummary(sheet, REFERENCE_NOW).state,
    'outside-window',
    '25 elapsed hours cannot become a within-window pair',
  )
  assert.equal(JSON.stringify(sheet), before)
})

test('QA #1081: task navigation must direct a forged 25h pair to review, never export', () => {
  const sheet = fullyFictionalSheet(OVER_24H)
  sheet.study.maxObservationWindowHours = 48
  const before = JSON.stringify(sheet)
  const action = observationNextAction(sheet, REFERENCE_NOW)
  assert.equal(action.stage, 'review')
  assert.match(action.title + ' ' + action.detail, /24 uur/)
  assert.doesNotMatch(action.title + ' ' + action.detail, /besparing bewezen|publiceer/i)
  assert.equal(JSON.stringify(sheet), before)
})

test('QA #1081: first-shop deadline must remain 24h despite a forged 48h window', () => {
  const sheet = fullyFictionalSheet()
  sheet.candidate.observedAt = ''
  sheet.study.maxObservationWindowHours = 48
  const before = JSON.stringify(sheet)
  const summary = observationWindowSummary(sheet, REFERENCE_NOW)
  assert.equal(summary.state, 'single-observation')
  assert.equal(summary.firstSide, 'baseline')
  assert.equal(summary.firstObservedAt, BASELINE_AT)
  assert.equal(summary.deadlineAt, EXACT_24H, 'displayed deadline must never be controlled by draft metadata')
  assert.equal(JSON.stringify(sheet), before)
})

test('QA #1081: malformed window values cannot silently re-authorize export', () => {
  for (const forgedWindow of [24.001, 25, 48, Number.POSITIVE_INFINITY, Number.NaN, 0, -1]) {
    const sheet = fullyFictionalSheet(EXACT_24H)
    sheet.study.maxObservationWindowHours = forgedWindow
    const result = observationSheetReadiness(sheet, REFERENCE_NOW)
    assert.equal(result.ready, false, String(forgedWindow) + ' must fail the canonical window contract')
    assert.ok(result.issues.length > 0, String(forgedWindow) + ' needs actionable feedback')
    assert.notEqual(observationNextAction(sheet, REFERENCE_NOW).stage, 'export')
  }
})

test('QA #1081: reopening a forged locally saved draft restores the canonical 24h limit', () => {
  const sheet = fullyFictionalSheet(OVER_24H)
  sheet.study.maxObservationWindowHours = 48
  const serialized = JSON.stringify(sheet)
  const restored = restoreObservationSheetDraft(serialized)
  assert.ok(restored, 'a matching structurally valid draft may be restored')
  assert.equal(restored.study.maxObservationWindowHours, 24)
  assert.equal(observationWindowSummary(restored, REFERENCE_NOW).state, 'outside-window')
  assert.equal(observationSheetReadiness(restored, REFERENCE_NOW).ready, false)
  assert.equal(observationNextAction(restored, REFERENCE_NOW).stage, 'review')
  assert.equal(JSON.stringify(sheet), serialized, 'restore must not modify untrusted saved data')
})
