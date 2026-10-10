import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet, observationSheetReadiness, observationWindowSummary, restoreObservationSheetDraft } from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'

// Every observation and store here is invented; unavailable lines carry NO prices.
// This checks UI vs. canonical converter contract, never evidence or savings.
function syntheticUnavailableSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'timestamp-syntax-only-test',
    participantKey: 'synthetic-key-only',
    population: 'synthetic-no-human-participants',
    region: 'synthetic-region',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
  })

  for (const [side, id, name, observedAt] of [
    ['baseline', 'plus-synthetic', 'PLUS synthetic store', '2026-10-04T12:00:00Z'],
    ['candidate', 'deka-synthetic', 'DekaMarkt synthetic store', '2026-10-04T12:30:00Z'],
  ]) {
    const observation = sheet[side]
    Object.assign(observation, {
      evidenceId: side + '-synthetic-evidence',
      observedAt,
      source: 'manual-cart',
      provenanceNote: 'Synthetic QA input; no genuine field observation.',
      store: { id, name },
    })
    observation.lines.forEach(line => {
      line.observedProduct.available = false
    })
  }

  assert.equal(sheet.baseline.lines.length + sheet.candidate.lines.length, 22)
  return sheet
}

test('canonical ISO with UTC and explicit positive timezone remains collection-ready, not savings proof', () => {
  const sheet = syntheticUnavailableSheet()
  sheet.candidate.observedAt = '2026-10-04T14:30:00+02:00'
  assert.deepEqual(observationSheetReadiness(sheet), { ready: true, issues: [] })
  assert.equal(observationWindowSummary(sheet).state, 'within-window')
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  assert.equal(study.baseline.basket.unresolvedLineCount, 11)
  assert.equal(study.candidate.basket.unresolvedLineCount, 11)
})

for (const [label, malformed] of [
  ['no explicit timezone', '2026-10-04T12:00:00'],
  ['date only', '2026-10-04'],
  ['RFC-2822 rather than canonical ISO', 'Sun, 04 Oct 2026 12:00:00 GMT'],
]) {
  for (const side of ['baseline', 'candidate']) {
    test(`M3 collector rejects ${label} on ${side} when canonical converter rejects it`, () => {
      const sheet = syntheticUnavailableSheet()
      sheet[side].observedAt = malformed

      // Existing converter is the canonical contract: must fail first.
      assert.throws(
        () => buildWeeklyBasketStudyFromObservationSheet(sheet),
        new RegExp(side + '\\.observedAt must be a valid timestamp'),
      )

      // Independent fail-closed UI guards: no misleading export-ready.
      const result = observationSheetReadiness(sheet)
      assert.equal(result.ready, false, `${side} must not be collection-ready`)
      assert.ok(result.issues.some(issue => /observatietijd/.test(issue)))
      assert.ok(result.issues.every(issue => !issue.includes(malformed)))
      const window = observationWindowSummary(sheet)
      assert.equal(window.state, 'single-observation')
      assert.equal(window.firstSide, side === 'baseline' ? 'candidate' : 'baseline')
    })
  }
}

test('two noncanonical date-only values must not create a false two-store window', () => {
  const sheet = syntheticUnavailableSheet()
  sheet.baseline.observedAt = '2026-10-04'
  sheet.candidate.observedAt = '2026-10-04'
  assert.throws(() => buildWeeklyBasketStudyFromObservationSheet(sheet), /observedAt must be a valid timestamp/)
  assert.equal(observationSheetReadiness(sheet).ready, false)
  assert.deepEqual(observationWindowSummary(sheet), { state: 'not-started' })
})

for (const side of ['baseline', 'candidate']) {
  test(`saved/restored M3 draft must not mark noncanonical ${side} timestamp export-ready`, () => {
    const original = syntheticUnavailableSheet()
    original[side].observedAt = '2026-10-04T12:00:00' // local-time ISO, no timezone
    const restored = restoreObservationSheetDraft(JSON.stringify(original))
    assert.ok(restored, 'the local draft must restore before readiness is evaluated')
    assert.throws(
      () => buildWeeklyBasketStudyFromObservationSheet(restored),
      new RegExp(side + '\\.observedAt must be a valid timestamp'),
    )
    assert.equal(observationSheetReadiness(restored).ready, false)
  })
}

test('calendar-impossible explicit UTC day must not be normalized into an observed day', () => {
  const sheet = syntheticUnavailableSheet()
  sheet.baseline.observedAt = '2026-02-31T12:00:00Z' // parser may normalize to 2026-03-03
  sheet.candidate.observedAt = '2026-03-03T12:30:00Z'
  assert.throws(
    () => buildWeeklyBasketStudyFromObservationSheet(sheet),
    /baseline\.observedAt must be a valid timestamp/,
  )
  assert.equal(observationSheetReadiness(sheet).ready, false)
  assert.notEqual(observationWindowSummary(sheet).state, 'within-window')
})

for (const [format, value] of [
  ['timezone-less ISO', '2026-10-04T12:00:00'],
  ['date-only', '2026-10-04'],
  ['RFC-2822', 'Sun, 04 Oct 2026 12:00:00 GMT'],
  ['calendar rollover', '2026-02-31T12:00:00Z'],
]) {
  test(`24-hour guidance cannot derive a deadline from invalid ${format}`, () => {
    const sheet = syntheticUnavailableSheet()
    sheet.baseline.observedAt = value

    // Assert the window directly, independently of the readiness assertion;
    // otherwise one failing gate can hide the other regression.
    assert.deepEqual(observationWindowSummary(sheet), {
      state: 'single-observation',
      firstSide: 'candidate',
      firstObservedAt: '2026-10-04T12:30:00.000Z',
      deadlineAt: '2026-10-05T12:30:00.000Z',
    })
  })
}

test('two invalid formatted timestamps must not define a completed observation window', () => {
  const sheet = syntheticUnavailableSheet()
  sheet.baseline.observedAt = '2026-10-04T12:00:00'
  sheet.candidate.observedAt = 'Sun, 04 Oct 2026 12:30:00 GMT'
  assert.deepEqual(observationWindowSummary(sheet), { state: 'not-started' })
})
