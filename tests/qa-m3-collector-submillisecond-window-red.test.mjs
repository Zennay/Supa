import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet, observationSheetReadiness, observationWindowSummary,
} from '../src/domain/m3ObservationSheet.ts'

// Synthetic blank M2-generated observation sheet; no actual retailer prices.
function filledSheet(first = '2026-10-08T10:00:00.000000000Z',
                     second = '2026-10-09T10:00:00.000000000Z') {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-collector-nano-window',
    participantKey: 'synthetic-private',
    population: 'Synthetic students',
    region: 'Fictitious town',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })
  for (const [side, name, key, at] of [
    ['baseline', 'PLUS synthetic', 'qa-plus', first],
    ['candidate', 'DekaMarkt synthetic', 'qa-deka', second],
  ]) {
    const observation = sheet[side]
    observation.evidenceId = side + '-qa-nanosecond'
    observation.observedAt = at
    observation.provenanceNote = 'Synthetic QA; not a retailer capture'
    observation.store = { id: key, name }
    observation.lines.forEach((line, index) => {
      const requirement = sheet.requirements[index]
      line.observedProduct = {
        available: true,
        productId: key + '-' + index,
        productName: requirement.query,
        packAmount: requirement.amount,
        packUnit: requirement.unit,
        packCount: 1,
        priceCents: 100 + index,
        sourceUrl: '',
        note: 'Fictional QA only',
      }
    })
  }
  return sheet
}

for (const [label, first, second, failingStore] of [
  ['24h plus one nanosecond on candidate',
    '2026-10-08T10:00:00.000000000Z',
    '2026-10-09T10:00:00.000000001Z', 'Winkel B'],
  ['fourth digit on baseline even inside valid one-hour interval',
    '2026-10-08T10:00:00.0001Z',
    '2026-10-08T11:00:00.0000Z', 'Winkel A'],
  ['ninth digit candidate with DST/UTC offset',
    '2026-10-24T18:00:00.000000000+02:00',
    '2026-10-25T17:00:00.000000001+01:00', 'Winkel B'],
]) {
  test('expected RED collector #1513: ' + label + ' must not show ready/within', () => {
    const sheet = filledSheet(first, second)
    const snapshot = structuredClone(sheet)
    const readiness = observationSheetReadiness(sheet)
    assert.equal(readiness.ready, false)
    assert.ok(readiness.issues.some(x => x.includes(failingStore) && x.includes('observatietijd')))
    assert.notEqual(observationWindowSummary(sheet).state, 'within-window')
    assert.deepEqual(sheet, snapshot)
  })
}

test('collector #1513: a single submillisecond-only timestamp cannot start the visible deadline', () => {
  const sheet = filledSheet()
  sheet.candidate.observedAt = ''
  sheet.baseline.observedAt = '2026-10-08T10:00:00.000000001Z'
  const before = structuredClone(sheet)
  assert.equal(observationSheetReadiness(sheet).ready, false)
  assert.equal(observationWindowSummary(sheet).state, 'not-started')
  assert.deepEqual(sheet, before)
})

test('collector #1513: exactly 24h with nine-digit all-zero tail stays ready', () => {
  const sheet = filledSheet()
  assert.deepEqual(observationSheetReadiness(sheet), { ready: true, issues: [] })
  assert.deepEqual(observationWindowSummary(sheet), {
    state: 'within-window', deltaHours: 24,
  })
})

test('collector #1513: whole milliseconds and exact UTC offset survive conservative policy', () => {
  const sheet = filledSheet(
    '2026-10-24T18:00:00.123000000+02:00',
    '2026-10-25T17:00:00.123000000+01:00',
  )
  assert.equal(observationSheetReadiness(sheet).ready, true)
  assert.equal(observationWindowSummary(sheet).state, 'within-window')
})
