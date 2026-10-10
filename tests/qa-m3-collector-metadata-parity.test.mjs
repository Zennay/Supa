import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationSheetReadiness,
  observationWindowSummary,
} from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'

// All values are synthetic. Both 11-demand baskets have 100% explicitly
// unavailable lines: no observed product/price/receipt/consent or field visit.
// Ready means structurally exportable, NEVER verified real-world evidence.
function fullyUnavailableSyntheticSheet(priceContext = 'in-store') {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'metadata-qa-synthetic',
    participantKey: 'synthetic-only',
    population: 'synthetic-only',
    region: 'synthetic-only',
    weekStart: '2026-09-28',
    priceContext,
  })
  for (const [side, id, name, observedAt] of [
    ['baseline', 'plus-test-only', 'PLUS synthetic', '2026-10-04T12:00:00Z'],
    ['candidate', 'deka-test-only', 'DekaMarkt synthetic', '2026-10-04T13:00:00Z'],
  ]) {
    Object.assign(sheet[side], {
      evidenceId: side + '-metadata-synthetic',
      observedAt,
      source: 'manual-cart',
      provenanceNote: 'Synthetic test fixture, not a field visit.',
      store: { id, name },
    })
    for (const line of sheet[side].lines) line.observedProduct.available = false
  }
  assert.equal(sheet.baseline.lines.length, 11)
  assert.equal(sheet.candidate.lines.length, 11)
  return sheet
}

for (const context of ['in-store', 'online-order']) {
  test(`valid historical 22-line synthetic sheet with ${context} agrees across collection, converter and claim gates`, () => {
    const sheet = fullyUnavailableSyntheticSheet(context)
    assert.deepEqual(observationSheetReadiness(sheet), { ready: true, issues: [] })
    assert.equal(observationWindowSummary(sheet).state, 'within-window')
    const converted = buildWeeklyBasketStudyFromObservationSheet(sheet)
    assert.equal(converted.priceContext, context)
    const report = assessWeeklyBasketStudy(converted)
    assert.equal(report.claimable, false)
    assert.equal(report.comparison.outcome, 'unknown')
    assert.equal(report.comparison.savingsCents, null)
  })
}

const CASES = [
  ['nonexistent February date', 'weekStart', '2026-02-30', /weekStart must be a valid YYYY-MM-DD date/],
  ['invalid month', 'weekStart', '2026-13-01', /weekStart must be a valid YYYY-MM-DD date/],
  ['noncanonical date', 'weekStart', '2026-10-4', /weekStart must be a valid YYYY-MM-DD date/],
  ['locale date without canonical format', 'weekStart', '04/10/2026', /weekStart must be a valid YYYY-MM-DD date/],
  ['unsupported price context', 'priceContext', 'delivery-app', /priceContext must be in-store or online-order/],
  ['mixed-case price context', 'priceContext', 'In-store', /priceContext must be in-store or online-order/],
  ['unsafe study key', 'studyId', 'Synthetic Invalid Key', /studyId must be a path-safe study key/],
  ['unsafe participant key', 'participantKey', 'Synthetic Invalid Key', /participantKey must be a pseudonymous path-safe key/],
]

for (const [label, field, value, expectedError] of CASES) {
  test(`collector cannot mark ${label} export-ready when canonical conversion rejects it`, () => {
    const sheet = fullyUnavailableSyntheticSheet()
    sheet.study[field] = value
    // First assert the independent downstream trust boundary. Tests are
    // expected RED only if the upstream collector incorrectly says ready.
    assert.throws(
      () => buildWeeklyBasketStudyFromObservationSheet(sheet),
      expectedError,
    )
    const readiness = observationSheetReadiness(sheet)
    assert.equal(readiness.ready, false, `${label} must not be collection-ready`)
    assert.ok(readiness.issues.length > 0, `${label} needs actionable feedback`)
    // Never include raw input strings or private keys in feedback.
    assert.equal(JSON.stringify(readiness).includes(value), false)
  })
}
