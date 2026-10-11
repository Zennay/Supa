import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationSheetReadiness,
  observationWindowSummary,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'

// Persisted-draft regression for #1513. No prices, receipt data, or real
// PLUS/DekaMarkt observations: every line is explicitly unavailable.
function restoredSheet(first, second) {
  const original = buildObservationSheet()
  Object.assign(original.study, {
    studyId: 'synthetic-reloaded-precision',
    participantKey: 'synthetic-test-only',
    population: 'synthetic',
    region: 'synthetic',
    weekStart: '2026-10-19',
    priceContext: 'in-store',
  })
  Object.assign(original.baseline, {
    evidenceId: 'qa-baseline',
    observedAt: first,
    store: { id: 'qa-plus', name: 'PLUS' },
    provenanceNote: 'SYNTHETIC QA - not actual store evidence',
  })
  Object.assign(original.candidate, {
    evidenceId: 'qa-candidate',
    observedAt: second,
    store: { id: 'qa-dekamarkt', name: 'DekaMarkt' },
    provenanceNote: 'SYNTHETIC QA - not actual store evidence',
  })
  for (const side of ['baseline', 'candidate']) {
    for (const line of original[side].lines) {
      line.observedProduct.available = false
    }
  }

  // Use the real v1 draft serializer's JSON container and canonical restore
  // instead of an in-memory clone or a mocked time-window implementation.
  const fromDisk = restoreObservationSheetDraft(JSON.stringify(original))
  assert.ok(fromDisk)
  assert.equal(fromDisk.baseline.observedAt, first)
  assert.equal(fromDisk.candidate.observedAt, second)
  assert.equal(fromDisk.study.maxObservationWindowHours, 24)
  assert.ok(
    [...fromDisk.baseline.lines, ...fromDisk.candidate.lines].every(
      (line) => line.observedProduct.available === false &&
        line.observedProduct.priceCents === null,
    ),
  )
  return fromDisk
}

test('QA expected RED: a resumed draft cannot bless a 999999ns 24h excess at .456 precision', () => {
  const first = '2026-10-24T12:00:00.456000000Z'
  const second = '2026-10-25T12:00:00.456999999Z'
  const restored = restoredSheet(first, second)
  assert.equal(observationWindowSummary(restored).state, 'outside-window')
  const ready = observationSheetReadiness(restored)
  assert.equal(ready.ready, false)
  assert.match(ready.issues.join(' '), /24|uur|observat/i)
})

test('QA expected RED: resumed DST-offset draft cannot bless hidden 999999ns excess', () => {
  const first = '2026-10-24T14:00:00.500000000+02:00'
  const second = '2026-10-25T13:00:00.500999999+01:00'
  const restored = restoredSheet(first, second)
  assert.equal(observationWindowSummary(restored).state, 'outside-window')
  assert.equal(observationSheetReadiness(restored).ready, false)
})

test('QA positive: persisted exact 24h with nonzero whole millisecond stays within', () => {
  const restored = restoredSheet(
    '2026-10-24T12:00:00.456000000Z',
    '2026-10-25T12:00:00.456000000Z',
  )
  assert.equal(observationWindowSummary(restored).state, 'within-window')
  assert.equal(observationSheetReadiness(restored).ready, true)
})
