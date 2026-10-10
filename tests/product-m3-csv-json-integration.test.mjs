import assert from 'node:assert/strict'
import test from 'node:test'

import { buildBlankM3FieldChecklistCsv } from '../scripts/m3-export-blank-field-checklist.mjs'
import { parseM3FieldCsv, reviewM3FieldCsv } from '../scripts/m3-review-field-csv.mjs'
import { buildObservationSheet, observationSheetReadiness, observationWindowSummary } from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'

// All inputs are invented. Explicit unavailable lines mean NO retailer price,
// receipt, product identity or participant claim is ever represented as evidence.
function pairedSyntheticInputs(baselineAt, candidateAt) {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'cross-format-synthetic',
    participantKey: 'synthetic-only',
    population: 'synthetic-only',
    region: 'synthetic-only',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
  })
  for (const [side, id, name, timestamp] of [
    ['baseline', 'plus-test-only', 'PLUS synthetic test', baselineAt],
    ['candidate', 'deka-test-only', 'DekaMarkt synthetic test', candidateAt],
  ]) {
    const observation = sheet[side]
    Object.assign(observation, {
      evidenceId: side + '-synthetic-raw',
      observedAt: timestamp,
      source: 'manual-cart',
      provenanceNote: 'Synthetic fixture; no store visited.',
      store: { id, name },
    })
    observation.lines.forEach(line => { line.observedProduct.available = false })
  }

  const rows = parseM3FieldCsv(buildBlankM3FieldChecklistCsv())
  assert.equal(rows.length, 23)
  for (let i = 1; i < rows.length; i++) {
    rows[i][7] = i <= 11 ? baselineAt : candidateAt
    rows[i][8] = 'in-store'
    rows[i][14] = 'nee'
    rows[i][15] = 'manual-cart'
    rows[i][17] = 'Synthetic, not evidence'
  }
  const csv = rows.map(row => row.map(value =>
    '"' + String(value).replaceAll('"', '""') + '"'
  ).join(',')).join('\n') + '\n'
  return { sheet, csv }
}

function review(csv) {
  const result = reviewM3FieldCsv(csv, { validateUnits: true })
  assert.equal(result.expectedRows, 22)
  assert.equal(result.evidenceVerified, false)
  assert.equal(result.releaseEligible, false)
  assert.equal(result.claimable, false)
  assert.equal(result.savingsCents, null)
  assert.doesNotMatch(JSON.stringify(result), /synthetic-only|synthetic-raw|store visited|participantKey/i)
  return result
}

test('M3 CSV and canonical JSON agree on a historical two-store unavailable pair, never a savings claim', () => {
  const { sheet, csv } = pairedSyntheticInputs('2026-10-04T12:00:00Z', '2026-10-04T13:00:00Z')
  const status = review(csv)
  assert.equal(status.completeRows, 22)
  assert.deepEqual(status.warnings, [])
  assert.equal(status.status, 'requires-canonical-human-verification')
  assert.deepEqual(observationSheetReadiness(sheet), { ready: true, issues: [] })
  assert.equal(observationWindowSummary(sheet).state, 'within-window')

  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  assert.equal(study.baseline.basket.unresolvedLineCount, 11)
  assert.equal(study.candidate.basket.unresolvedLineCount, 11)
  const assessment = assessWeeklyBasketStudy(study)
  assert.equal(assessment.claimable, false)
  assert.equal(assessment.comparison.outcome, 'unknown')
  assert.equal(assessment.comparison.savingsCents, null)
})

for (const [label, baselineAt, candidateAt, expectedComplete] of [
  ['future baseline', '2099-10-04T12:00:00Z', '2026-10-04T13:00:00Z', 11],
  ['future candidate', '2026-10-04T12:00:00Z', '2099-10-04T13:00:00Z', 11],
  ['both future in 1-hour window', '2099-10-04T12:00:00Z', '2099-10-04T13:00:00Z', 0],
  ['calendar rollover baseline', '2026-02-31T12:00:00Z', '2026-03-03T13:00:00Z', 11],
  ['missing candidate timezone', '2026-10-04T12:00:00Z', '2026-10-04T13:00:00', 11],
]) {
  test(`M3 CSV, collector and JSON reject ${label} across their separate trust gates`, () => {
    const { sheet, csv } = pairedSyntheticInputs(baselineAt, candidateAt)
    const result = review(csv)
    assert.equal(result.completeRows, expectedComplete)
    assert.ok(result.warnings.includes('invalid-timestamp'), label)
    assert.ok(result.warnings.includes('missing-or-incomplete-observations'), label)
    assert.equal(result.status, 'incomplete-or-needs-review')
    const ui = observationSheetReadiness(sheet)
    assert.equal(ui.ready, false, label)
    assert.ok(ui.issues.some(issue => /observatietijd/.test(issue)), label)
    assert.notEqual(observationWindowSummary(sheet).state, 'within-window')
    assert.throws(
      () => buildWeeklyBasketStudyFromObservationSheet(sheet),
      /observedAt must be a valid timestamp/,
    )
  })
}
