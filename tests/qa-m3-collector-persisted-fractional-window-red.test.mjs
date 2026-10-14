import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationSheetReadiness,
  observationWindowSummary,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'

// Separate v1 persisted-draft journey, deliberately exercising the actual
// JSON storage/restore path rather than direct in-memory time comparisons.
// All 22 products are marked UNAVAILABLE solely for synthetic QA completion;
// no real prices, receipts, consent or field observations are fabricated.
function restoredSyntheticSheet(first, second) {
  const draft = buildObservationSheet()
  Object.assign(draft.study, {
    studyId: 'qa-restored-draft-time',
    participantKey: 'synthetic-qa-participant',
    population: 'controlled-test',
    region: 'synthetic',
    weekStart: '2026-10-19',
    priceContext: 'in-store',
  })
  Object.assign(draft.baseline, {
    evidenceId: 'baseline-qa-001',
    observedAt: first,
    provenanceNote: 'SYNTHETIC no actual store evidence',
    store: { id: 'plus-qa', name: 'PLUS' },
  })
  Object.assign(draft.candidate, {
    evidenceId: 'candidate-qa-001',
    observedAt: second,
    provenanceNote: 'SYNTHETIC no actual store evidence',
    store: { id: 'dekamarkt-qa', name: 'DekaMarkt' },
  })
  for (const side of ['baseline', 'candidate']) {
    for (const line of draft[side].lines) {
      line.observedProduct.available = false
    }
  }

  const persisted = JSON.stringify(draft)
  const restored = restoreObservationSheetDraft(persisted)
  assert.ok(restored)
  assert.equal(restored.evidenceStatus, 'collection-template-not-evidence')
  assert.equal(restored.study.maxObservationWindowHours, 24)
  assert.equal(restored.baseline.observedAt, first)
  assert.equal(restored.candidate.observedAt, second)
  assert.ok(
    [...restored.baseline.lines, ...restored.candidate.lines].every(
      (line) => line.observedProduct.available === false &&
        line.observedProduct.priceCents === null,
    ),
  )
  return restored
}

test('QA persisted collector positive: exact 24h with trailing zero 9 digits remains inside', () => {
  const restored = restoredSyntheticSheet(
    '2026-10-24T12:00:00.000000000Z',
    '2026-10-25T12:00:00.000000000Z',
  )
  assert.equal(observationWindowSummary(restored).state, 'within-window')
  assert.equal(observationSheetReadiness(restored).ready, true)
})

test('QA persisted collector positive: extra 1ms fails both readiness and 24h summary', () => {
  const restored = restoredSyntheticSheet(
    '2026-10-24T12:00:00.000000000Z',
    '2026-10-25T12:00:00.001000000Z',
  )
  assert.equal(observationWindowSummary(restored).state, 'outside-window')
  const verdict = observationSheetReadiness(restored)
  assert.equal(verdict.ready, false)
  assert.ok(verdict.issues.length > 0)
})

test('QA persisted collector expected RED: round-tripped 24h+1ns cannot be exported as ready', () => {
  const restored = restoredSyntheticSheet(
    '2026-10-24T12:00:00.000000000Z',
    '2026-10-25T12:00:00.000000001Z',
  )

  assert.equal(observationWindowSummary(restored).state, 'outside-window')
  const verdict = observationSheetReadiness(restored)
  assert.equal(verdict.ready, false)
  assert.match(verdict.issues.join(' '), /24|uur|observat/i)
})

test('QA persisted collector expected RED: inverse round-tripped 24h+1ns must not look inside', () => {
  const restored = restoredSyntheticSheet(
    '2026-10-25T12:00:00.000000001Z',
    '2026-10-24T12:00:00.000000000Z',
  )

  assert.equal(observationWindowSummary(restored).state, 'outside-window')
  assert.equal(observationSheetReadiness(restored).ready, false)
})

test('QA persisted collector expected RED: time-zone offset normalization preserves the 1ns breach', () => {
  const restored = restoredSyntheticSheet(
    '2026-10-24T14:00:00.000000000+02:00',
    '2026-10-25T13:00:00.000000001+01:00',
  )

  assert.equal(observationWindowSummary(restored).state, 'outside-window')
  assert.equal(observationSheetReadiness(restored).ready, false)
})
