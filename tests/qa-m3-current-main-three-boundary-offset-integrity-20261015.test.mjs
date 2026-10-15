import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationSheetReadiness,
  observationWindowSummary,
  validObservedAt,
} from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'

// Test-only, unavailable baskets: these are NOT observed supermarket products,
// human field evidence, receipts, permissions or public price/savings claims.
const UTC = '2026-10-04T12:00:00Z'
const PREFIX = '2026-10-04T12:00:00'

function fictionalSheet(baselineAt = UTC, candidateAt = UTC) {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'offset-parity-fictional',
    participantKey: 'fictional-no-participant',
    population: 'synthetic-only',
    region: 'synthetic-only',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
  })
  for (const [side, name, observedAt] of [
    ['baseline', 'PLUS synthetic', baselineAt],
    ['candidate', 'DekaMarkt synthetic', candidateAt],
  ]) {
    Object.assign(sheet[side], {
      evidenceId: side + '-fictional',
      observedAt,
      source: 'manual-cart',
      provenanceNote: 'Fictional test only, never an observation.',
      store: { id: side + '-fictional-store', name },
    })
    for (const line of sheet[side].lines) {
      line.observedProduct.available = false
    }
  }
  return sheet
}

for (const offset of ['+15:00', '-15:00', '+23:00', '+14:30', '-14:01']) {
  for (const side of ['baseline', 'candidate']) {
    const impossible = PREFIX + offset
    const sheet = fictionalSheet(
      side === 'baseline' ? impossible : UTC,
      side === 'candidate' ? impossible : UTC,
    )
    test(`M3 collector rejects impossible ${offset} at ${side} while Date.parse is finite`, () => {
      assert.ok(Number.isFinite(Date.parse(impossible)))
      assert.equal(validObservedAt(impossible), null)
      const ready = observationSheetReadiness(sheet)
      assert.equal(ready.ready, false)
      assert.ok(ready.issues.some(issue => /observatietijd/i.test(issue)))
      assert.notEqual(observationWindowSummary(sheet).state, 'within-window')
    })
    test(`M3 canonical converter rejects impossible ${offset} at ${side}`, () => {
      assert.throws(
        () => buildWeeklyBasketStudyFromObservationSheet(sheet),
        /observedAt must be a valid timestamp/,
      )
    })
    test(`M3 direct assessment abstains on impossible ${offset} at ${side}`, () => {
      const legitimate = buildWeeklyBasketStudyFromObservationSheet(fictionalSheet())
      legitimate[side].observedAt = impossible
      const result = assessWeeklyBasketStudy(legitimate)
      assert.equal(result.claimable, false)
      assert.equal(result.comparison.outcome, 'unknown')
      assert.equal(result.comparison.savingsCents, null)
      assert.ok(result.reasons.includes(`${side} observedAt is not a valid timestamp`))
      assert.doesNotMatch(JSON.stringify(result), /fictional-no-participant|PRIVATE-TOKEN/i)
    })
  }
}

for (const offset of ['+14:00', '-14:00']) {
  test(`valid civil UTC offset ${offset} survives all 3 current-main gates without claiming money`, () => {
    const first = PREFIX + offset
    const second = '2026-10-04T13:00:00' + offset
    const sheet = fictionalSheet(first, second)
    assert.notEqual(validObservedAt(first), null)
    assert.deepEqual(observationSheetReadiness(sheet), { ready: true, issues: [] })
    assert.equal(observationWindowSummary(sheet).state, 'within-window')
    const assessment = assessWeeklyBasketStudy(
      buildWeeklyBasketStudyFromObservationSheet(sheet),
    )
    assert.equal(assessment.observationWindowHours, 1)
    assert.equal(assessment.claimable, false)
    assert.equal(assessment.comparison.outcome, 'unknown')
    assert.equal(assessment.comparison.savingsCents, null)
    assert.ok(!assessment.reasons.some(reason => /observedAt is not a valid timestamp/.test(reason)))
  })
}
