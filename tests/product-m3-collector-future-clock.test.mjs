import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationSheetReadiness,
  observationWindowSummary,
} from '../src/domain/m3ObservationSheet.ts'

// Deliberately unavailable synthetic lines: this tests collection timestamps,
// not invented product prices, retailer receipts or a savings claim.
function sheetWithObservedTimes(baselineAt, candidateAt) {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'future-clock-collector-synthetic',
    participantKey: 'test-only-student',
    population: 'synthetic target group',
    region: 'synthetic region',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
  })
  for (const [side, id, name, at] of [
    ['baseline', 'plus-synthetic', 'PLUS Leiden testfiliaal', baselineAt],
    ['candidate', 'deka-synthetic', 'DekaMarkt Leiden testfiliaal', candidateAt],
  ]) {
    const observation = sheet[side]
    observation.store.id = id
    observation.store.name = name
    observation.evidenceId = side + '-synthetic-unavailable'
    observation.observedAt = at
    observation.source = 'manual-cart'
    observation.provenanceNote = 'Synthetic regression only, no real observation.'
    observation.lines.forEach(line => { line.observedProduct.available = false })
  }
  return sheet
}

test('M3 collector readiness preserves valid historical two-store captures', () => {
  const sheet = sheetWithObservedTimes(
    '2026-10-04T12:00:00Z', '2026-10-04T13:00:00Z',
  )
  assert.deepEqual(observationSheetReadiness(sheet), { ready: true, issues: [] })
  assert.equal(observationWindowSummary(sheet).state, 'within-window')
})

test('M3 collector cannot report export-ready when either store timestamp is in the future', () => {
  for (const futureSide of ['baseline', 'candidate']) {
    const sheet = sheetWithObservedTimes(
      '2026-10-04T12:00:00Z', '2026-10-04T13:00:00Z',
    )
    sheet[futureSide].observedAt = '2099-10-10T13:00:00+01:00'
    const status = observationSheetReadiness(sheet)
    assert.equal(status.ready, false, futureSide)
    assert.ok(
      status.issues.some(issue => /observatietijd/.test(issue)),
      futureSide,
    )
  }
})

test('M3 collector cannot call a wholly future 1-hour-apart pair ready or within-window', () => {
  const sheet = sheetWithObservedTimes(
    '2099-10-10T12:00:00Z', '2099-10-10T08:00:00-05:00',
  )
  const status = observationSheetReadiness(sheet)
  assert.equal(status.ready, false)
  assert.ok(status.issues.some(issue => /observatietijd/.test(issue)))
  assert.notEqual(observationWindowSummary(sheet).state, 'within-window')
})
