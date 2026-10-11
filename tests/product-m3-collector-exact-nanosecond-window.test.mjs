import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationWindowSummary,
  observationSheetReadiness,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'

function completeSyntheticSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-study-001',
    participantKey: 'student-qa-001',
    population: 'synthetic QA only',
    region: 'synthetic region',
    weekStart: '2026-10-19',
    priceContext: 'in-store',
  })
  for (const [side, id, name, evidenceId] of [
    ['baseline', 'synthetic-plus', 'PLUS synthetic QA', 'synthetic-a'],
    ['candidate', 'synthetic-deka', 'DekaMarkt synthetic QA', 'synthetic-b'],
  ]) {
    const observation = sheet[side]
    observation.store.id = id
    observation.store.name = name
    observation.evidenceId = evidenceId
    observation.provenanceNote = 'Synthetic unavailable fixture, never a retailer observation.'
    observation.lines.forEach((line) => {
      line.observedProduct.available = false
    })
  }
  return sheet
}

test('M3 ready and elapsed-status must both reject 24h + 1ns in either store order', () => {
  const early = '2026-10-24T16:00:00.000000000Z'
  const late = '2026-10-25T16:00:00.000000001Z'
  for (const [first, second] of [[early, late], [late, early]]) {
    const sheet = completeSyntheticSheet()
    sheet.baseline.observedAt = first
    sheet.candidate.observedAt = second

    const readiness = observationSheetReadiness(sheet)
    assert.equal(readiness.ready, false)
    assert.ok(readiness.issues.some((issue) => issue.includes('nanosecondegrens overschreden')))
    assert.equal(observationWindowSummary(sheet).state, 'outside-window')

    const restored = restoreObservationSheetDraft(JSON.stringify(sheet))
    assert.ok(restored)
    assert.equal(observationSheetReadiness(restored).ready, false)
    assert.equal(observationWindowSummary(restored).state, 'outside-window')
  }
})

test('M3 exact 24h and 24h - 1ns retain collection-ready positive controls', () => {
  const start = '2026-10-24T16:00:00.000000000Z'
  for (const candidate of [
    '2026-10-25T16:00:00.000000000Z',
    '2026-10-25T15:59:59.999999999Z',
    '2026-10-25T16:00:00.000Z',
  ]) {
    const sheet = completeSyntheticSheet()
    sheet.baseline.observedAt = start
    sheet.candidate.observedAt = candidate
    assert.equal(observationWindowSummary(sheet).state, 'within-window')
    assert.equal(observationSheetReadiness(sheet).ready, true)
  }
})

test('M3 single-side UTC deadline preserves nanoseconds instead of showing a false millisecond wall', () => {
  const sheet = buildObservationSheet()
  sheet.baseline.observedAt = '2026-10-24T16:00:00.123456789+02:00'
  const result = observationWindowSummary(sheet)

  assert.equal(result.state, 'single-observation')
  assert.equal(result.firstSide, 'baseline')
  assert.equal(result.firstObservedAt, '2026-10-24T14:00:00.123456789Z')
  assert.equal(result.deadlineAt, '2026-10-25T14:00:00.123456789Z')

  sheet.baseline.observedAt = ''
  sheet.candidate.observedAt = '2026-10-24T16:00:00.000Z'
  const inverse = observationWindowSummary(sheet)
  assert.equal(inverse.state, 'single-observation')
  assert.equal(inverse.firstSide, 'candidate')
  assert.equal(inverse.deadlineAt, '2026-10-25T16:00:00.000Z')
})

test('M3 reject invalid observation clocks consistently in the sheet and readiness', () => {
  for (const invalid of [
    '2026-10-24T12:00:00.1234567890Z',
    '2026-02-29T12:00:00Z',
    '2026-10-24T12:00:00+24:00',
  ]) {
    const sheet = completeSyntheticSheet()
    sheet.baseline.observedAt = invalid
    sheet.candidate.observedAt = '2026-10-24T16:00:00Z'
    assert.equal(observationSheetReadiness(sheet).ready, false)
    assert.equal(observationWindowSummary(sheet).state, 'single-observation')
  }
})
