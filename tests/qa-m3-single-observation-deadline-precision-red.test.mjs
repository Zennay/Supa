import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationWindowSummary,
} from '../src/domain/m3ObservationSheet.ts'

// QA #1513 single-observation countdown: the collection UI must not show an
// exact-looking deadline after silently discarding fractional precision.
// Compatible with either accepted owner policy: exact nanosecond deadline,
// or conservative refusal to open a window for unsupported submillisecond
// input. Does not prescribe a production fix or invent retailer evidence.
function onlyFirstObservation(first) {
  const sheet = buildObservationSheet()
  sheet.baseline.observedAt = first
  return observationWindowSummary(sheet)
}

function assertExactOrRejected(summary, expectedFirst, expectedDeadline) {
  if (summary.state !== 'single-observation') {
    // Conservative invalid-precision policy may refuse to start the clock.
    assert.notEqual(summary.state, 'within-window')
    assert.notEqual(summary.state, 'outside-window')
    return
  }

  // Under exact-precision policy A, both ISO strings must represent the
  // original nanosecond clock, not a Date.parse milliseconds truncation.
  assert.equal(summary.firstSide, 'baseline')
  assert.equal(summary.firstObservedAt, expectedFirst)
  assert.equal(summary.deadlineAt, expectedDeadline)
}

test('QA expected RED: collector must not present a silently truncated exact-looking deadline', () => {
  const first = '2026-10-24T12:00:00.123999999Z'
  const summary = onlyFirstObservation(first)
  assertExactOrRejected(
    summary,
    '2026-10-24T12:00:00.123999999Z',
    '2026-10-25T12:00:00.123999999Z',
  )
})

test('QA expected RED: timezone-normalized single-observation deadline retains sub-ms precision or abstains', () => {
  const summary = onlyFirstObservation('2026-10-24T14:00:00.456789123+02:00')
  assertExactOrRejected(
    summary,
    '2026-10-24T12:00:00.456789123Z',
    '2026-10-25T12:00:00.456789123Z',
  )
})

test('QA positive: supported millisecond first-observation deadline remains exactly 24h later', () => {
  const summary = onlyFirstObservation('2026-10-24T12:00:00.456000000Z')
  assert.equal(summary.state, 'single-observation')
  assert.equal(summary.firstSide, 'baseline')
  assert.equal(summary.firstObservedAt, '2026-10-24T12:00:00.456Z')
  assert.equal(summary.deadlineAt, '2026-10-25T12:00:00.456Z')
})
