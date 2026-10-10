import assert from 'node:assert/strict'
import test from 'node:test'

import { buildBlankM3FieldChecklistCsv } from '../scripts/m3-export-blank-field-checklist.mjs'
import { parseM3FieldCsv, reviewM3FieldCsv } from '../scripts/m3-review-field-csv.mjs'
import {
  buildObservationSheet,
  observationSheetReadiness,
  observationWindowSummary,
} from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'

// Only invented, explicitly unavailable 11-demand baskets: zero observed
// product/price/receipt/consent data. This test must NEVER be field evidence.
const UTC = '2026-10-04T12:00:00Z'
const HISTORICAL = '2026-10-04T12:00:00'
const INVALID_OFFSETS = ['+15:00', '-15:00', '+23:00', '+14:30', '-14:01']

function inputs(baselineAt = UTC, candidateAt = UTC) {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'offset-parity-synthetic',
    participantKey: 'synthetic-only',
    population: 'synthetic-only',
    region: 'synthetic-only',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
  })
  for (const [side, id, name, observedAt] of [
    ['baseline', 'plus-synthetic', 'PLUS synthetic', baselineAt],
    ['candidate', 'deka-synthetic', 'DekaMarkt synthetic', candidateAt],
  ]) {
    Object.assign(sheet[side], {
      evidenceId: side + '-offset-synthetic',
      observedAt,
      source: 'manual-cart',
      provenanceNote: 'Synthetic test only; no visit or observation.',
      store: { id, name },
    })
    for (const line of sheet[side].lines) line.observedProduct.available = false
  }

  const rows = parseM3FieldCsv(buildBlankM3FieldChecklistCsv())
  assert.equal(rows.length, 23)
  for (let i = 1; i < rows.length; i++) {
    rows[i][7] = i <= 11 ? baselineAt : candidateAt
    rows[i][8] = 'in-store'
    rows[i][14] = 'nee'
    rows[i][15] = 'manual-cart'
    rows[i][17] = 'Synthetic only; no store observation'
  }
  const csv = rows.map(row => row.map(value =>
    '"' + String(value).replaceAll('"', '""') + '"',
  ).join(',')).join('\n') + '\n'
  return { sheet, csv }
}

for (const offset of INVALID_OFFSETS) {
  for (const side of ['baseline', 'candidate']) {
    const invalid = HISTORICAL + offset
    const baselineAt = side === 'baseline' ? invalid : UTC
    const candidateAt = side === 'candidate' ? invalid : UTC

    test(`M3 CSV refuses impossible UTC offset ${offset} on ${side}, even when Date.parse accepts it`, () => {
      assert.ok(Number.isFinite(Date.parse(invalid)), 'JS parsing itself is not validation')
      const { csv } = inputs(baselineAt, candidateAt)
      const result = reviewM3FieldCsv(csv, { validateUnits: true })
      assert.equal(result.completeRows, 11)
      assert.ok(result.warnings.includes('invalid-timestamp'))
      assert.ok(result.warnings.includes('missing-or-incomplete-observations'))
      assert.equal(result.evidenceVerified, false)
      assert.equal(result.releaseEligible, false)
      assert.equal(result.claimable, false)
      assert.equal(result.savingsCents, null)
      assert.doesNotMatch(JSON.stringify(result), /participantKey|synthetic-only|offset-synthetic/i)
    })

    test(`M3 collector refuses impossible UTC offset ${offset} on ${side} for readiness and window`, () => {
      const { sheet } = inputs(baselineAt, candidateAt)
      const readiness = observationSheetReadiness(sheet)
      assert.equal(readiness.ready, false)
      assert.ok(readiness.issues.some(issue => /observatietijd/.test(issue)))
      assert.notEqual(observationWindowSummary(sheet).state, 'within-window')
    })

    test(`M3 JSON conversion and direct financial assessment reject ${offset} on ${side} independently`, () => {
      const { sheet } = inputs(baselineAt, candidateAt)
      assert.throws(
        () => buildWeeklyBasketStudyFromObservationSheet(sheet),
        /observedAt must be a valid timestamp/,
      )
      // Must exercise the assessment independently of any converter preflight:
      // a direct caller can load untrusted JSON without going via the collector.
      const validStudy = buildWeeklyBasketStudyFromObservationSheet(inputs().sheet)
      validStudy[side].observedAt = invalid
      const result = assessWeeklyBasketStudy(validStudy)
      assert.equal(result.claimable, false)
      assert.equal(result.comparison.outcome, 'unknown')
      assert.equal(result.comparison.savingsCents, null)
      assert.ok(result.reasons.includes(`${side} observedAt is not a valid timestamp`))
    })
  }
}

for (const offset of ['+14:00', '-14:00']) {
  test(`M3 valid boundary UTC offset ${offset} passes all structural layers without asserting savings`, () => {
    const { sheet, csv } = inputs(HISTORICAL + offset, '2026-10-04T13:00:00' + offset)
    const result = reviewM3FieldCsv(csv, { validateUnits: true })
    assert.equal(result.completeRows, 22)
    assert.deepEqual(result.warnings, [])
    assert.equal(result.status, 'requires-canonical-human-verification')
    assert.equal(result.evidenceVerified, false)
    assert.equal(result.releaseEligible, false)
    assert.equal(result.claimable, false)
    assert.deepEqual(observationSheetReadiness(sheet), { ready: true, issues: [] })
    assert.equal(observationWindowSummary(sheet).state, 'within-window')
    const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
    const assessment = assessWeeklyBasketStudy(study)
    assert.equal(assessment.observationWindowHours, 1)
    assert.equal(assessment.claimable, false) // both baskets explicitly unavailable
    assert.equal(assessment.comparison.outcome, 'unknown')
    assert.equal(assessment.comparison.savingsCents, null)
    assert.ok(!assessment.reasons.some(reason => /observedAt is not a valid timestamp/.test(reason)))
  })
}
