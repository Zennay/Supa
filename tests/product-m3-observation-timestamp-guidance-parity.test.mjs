import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildObservationSheet,
  observationSheetReadiness,
  validObservedAt,
} from '../src/domain/m3ObservationSheet.ts'
import {
  observationNextAction,
  observationNextTaskSelector,
} from '../src/features/observation/observationNextStep.ts'

// All data below are synthetic UI fixtures. No supermarket observation is claimed.
function preparedSheet(side) {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-navigation-01',
    participantKey: 'anonymous-test',
    population: 'Uitwonende studenten',
    region: 'Leiden',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
  })
  const store = sheet[side]
  store.store.name = side === 'baseline' ? 'PLUS Leiden' : 'DekaMarkt Leiden'
  store.store.id = side + '-leiden'
  store.evidenceId = side + '-timestamp-fixture'
  store.provenanceNote = 'Fictieve regressietest zonder echte prijzen'
  if (side === 'candidate') {
    // The task guide deliberately completes PLUS before addressing DekaMarkt.
    // Complete all baseline fields/rows to exercise the candidate field.
    sheet.baseline.store.name = 'PLUS Leiden'
    sheet.baseline.store.id = 'plus-leiden'
    sheet.baseline.evidenceId = 'baseline-timestamp-fixture'
    sheet.baseline.provenanceNote = 'Fictieve regressietest zonder echte prijzen'
    sheet.baseline.observedAt = '2026-10-14T08:00:00Z'
    for (const line of sheet.baseline.lines) line.observedProduct.available = false
  }
  return sheet
}

const invalidTimes = [
  '2026-10-14', // Date.parse accepts a date without an observation instant
  '2026-10-14T09:00:00', // implicit host timezone is not reproducible
  '2026-02-30T09:00:00Z', // Date.parse may roll this into March
  '2026-10-14T24:01:00Z',
  '2026-10-14T09:60:00Z',
  '2026-10-14T09:00:60Z',
  '2026-10-14T09:00:00+25:00',
  '2026-10-14T09:00:00+01:60',
  '14 October 2026 09:00 UTC',
]

test('M3 next-task focus rejects exactly the timestamps rejected by canonical readiness', () => {
  for (const side of ['baseline', 'candidate']) {
    for (const time of invalidTimes) {
      const sheet = preparedSheet(side)
      sheet[side].observedAt = time
      const before = structuredClone(sheet)
      assert.equal(validObservedAt(time), null, time)
      assert.equal(observationSheetReadiness(sheet).ready, false, time)
      const action = observationNextAction(sheet)
      assert.equal(action.stage, 'store', `${side}: ${time}`)
      assert.equal(action.side, side, time)
      assert.equal(action.field, 'observedAt', time)
      assert.match(action.detail, /echte meetmoment/, time)
      assert.equal(
        observationNextTaskSelector(action),
        `[data-observation-side="${side}"] [data-observation-store-field="observedAt"]`,
        time,
      )
      assert.deepEqual(sheet, before, 'navigation must not mutate the private sheet')
    }
  }
})

test('valid explicit instants advance the task even when daylight-saving offsets differ', () => {
  for (const time of [
    '2026-10-25T02:30:00+02:00',
    '2026-10-25T02:30:00+01:00',
    '2026-10-25T01:30:00Z',
    '2026-10-14T09:00:00.123Z',
  ]) {
    const sheet = preparedSheet('baseline')
    sheet.baseline.observedAt = time
    assert.notEqual(validObservedAt(time), null, time)
    const action = observationNextAction(sheet)
    assert.equal(action.stage, 'line', `valid time ${time} should advance to a real ingredient`)
    assert.equal(action.side, 'baseline')
    assert.equal(action.ingredientId, sheet.baseline.lines[0].ingredientId)
  }
})

test('malformed direct calls never trigger an optimistic export or a new savings claim', () => {
  for (const value of [null, [], {}, { study: null }]) {
    const action = observationNextAction(value)
    assert.equal(action.stage, 'review')
    assert.notEqual(action.stage, 'export')
  }
})

test('M3 guides duplicate store identities to DekaMarkt instead of generic review', () => {
  const sheet = preparedSheet('baseline')
  const other = preparedSheet('candidate')
  Object.assign(sheet.candidate, other.candidate)
  sheet.baseline.observedAt = '2026-10-14T09:00:00Z'
  sheet.candidate.observedAt = '2026-10-14T10:00:00Z'
  // Actual observations cannot share one store identity: do not silently
  // correct evidence, and never advise inventing a different source ID.
  sheet.candidate.store.id = sheet.baseline.store.id
  for (const side of ['baseline', 'candidate']) {
    for (const line of sheet[side].lines) {
      line.observedProduct.available = false
    }
  }
  const before = structuredClone(sheet)
  assert.equal(observationSheetReadiness(sheet).ready, false)
  const action = observationNextAction(sheet)
  assert.equal(action.stage, 'store')
  assert.equal(action.side, 'candidate')
  assert.equal(action.field, 'id')
  assert.match(action.detail, /echte codes/)
  assert.match(action.detail, /verzin geen code/)
  assert.equal(
    observationNextTaskSelector(action),
    '[data-observation-side="candidate"] [data-observation-store-field="id"]',
  )
  assert.deepEqual(sheet, before)

  sheet.candidate.store.id = 'dekamarkt-leiden'
  assert.equal(observationSheetReadiness(sheet).ready, true)
  assert.equal(observationNextAction(sheet).stage, 'export')
})
