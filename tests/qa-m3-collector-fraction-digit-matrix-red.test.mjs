import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildObservationSheet,
  observationSheetReadiness,
  observationWindowSummary,
} from '../src/domain/m3ObservationSheet.ts'

// Deterministic, synthetic only. This matrix exhausts the unsupported
// fractional digit positions between 1 millisecond and 1 nanosecond.
// All 22 product lines explicitly unavailable: never observed store prices.
function syntheticCollector(baselineObservedAt, candidateObservedAt) {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-fraction-digit-matrix',
    participantKey: 'synthetic-qa-001',
    population: 'qa-regression',
    region: 'synthetic',
    weekStart: '2026-10-19',
    priceContext: 'in-store',
  })
  for (const [side, name, storeId, observedAt] of [
    ['baseline', 'PLUS', 'plus-qa', baselineObservedAt],
    ['candidate', 'DekaMarkt', 'dekamarkt-qa', candidateObservedAt],
  ]) {
    Object.assign(sheet[side], {
      evidenceId: storeId,
      observedAt,
      provenanceNote: 'SYNTHETIC QA / NO SHOPPING OBSERVATION',
      store: { id: storeId, name },
    })
    for (const line of sheet[side].lines) {
      line.observedProduct.available = false
    }
  }
  return sheet
}

const exactBaseline = '2026-10-24T12:00:00.000Z'

for (const precision of [4, 5, 6, 7, 8, 9]) {
  const fractionalSeconds = '0'.repeat(precision - 1) + '1'
  test(`QA expected RED: 24h plus 10^(-${precision}) second must be outside in collector`, () => {
    const candidate = `2026-10-25T12:00:00.${fractionalSeconds}Z`
    const sheet = syntheticCollector(exactBaseline, candidate)
    // The parser can represent the ISO timestamp syntactically, but
    // millisecond Date.parse silently discards its positive sub-ms part.
    assert.equal(observationWindowSummary(sheet).state, 'outside-window')
    assert.equal(observationSheetReadiness(sheet).ready, false)
  })

  test(`QA positive control: exact 24h with ${precision}-digit trailing zeros remains within`, () => {
    const candidate = `2026-10-25T12:00:00.${'0'.repeat(precision)}Z`
    const sheet = syntheticCollector(exactBaseline, candidate)
    assert.equal(observationWindowSummary(sheet).state, 'within-window')
    assert.equal(observationSheetReadiness(sheet).ready, true)
  })
}
