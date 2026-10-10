import assert from 'node:assert/strict'
import test from 'node:test'

import { buildBlankM3FieldChecklistCsv } from '../scripts/m3-export-blank-field-checklist.mjs'
import { parseM3FieldCsv, reviewM3FieldCsv } from '../scripts/m3-review-field-csv.mjs'
import { buildObservationSheet, observationSheetReadiness, observationWindowSummary } from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

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

for (const [name, baselineAt, candidateAt, expectedHours] of [
  ['explicit negative UTC offset', '2026-10-04T12:00:00Z', '2026-10-04T08:30:00-04:00', 0.5],
  ['exact inclusive 24h with positive UTC offset', '2026-10-04T12:00:00Z', '2026-10-05T13:00:00+01:00', 24],
]) {
  test(`M3 cross-format valid observation offsets remain exactly comparable: ${name}`, () => {
    const { sheet, csv } = pairedSyntheticInputs(baselineAt, candidateAt)
    assert.equal(review(csv).status, 'requires-canonical-human-verification')
    assert.deepEqual(observationSheetReadiness(sheet), { ready: true, issues: [] })
    const window = observationWindowSummary(sheet)
    assert.equal(window.state, 'within-window')
    assert.equal(window.deltaHours, expectedHours)
    const assessment = assessWeeklyBasketStudy(
      buildWeeklyBasketStudyFromObservationSheet(sheet),
    )
    assert.equal(assessment.observationWindowHours, expectedHours)
    assert.equal(assessment.claimable, false)
    assert.equal(assessment.comparison.savingsCents, null)
  })
}

test('M3 cross-format 24h+1ms window cannot become a claim, even with structurally complete rows', () => {
  const { sheet, csv } = pairedSyntheticInputs(
    '2026-10-04T12:00:00.000Z', '2026-10-05T12:00:00.001Z',
  )
  const field = review(csv)
  assert.equal(field.completeRows, 22)
  assert.ok(field.warnings.includes('capture-window-over-24-hours'))
  assert.equal(field.status, 'incomplete-or-needs-review')
  assert.equal(observationSheetReadiness(sheet).ready, false)
  assert.equal(observationWindowSummary(sheet).state, 'outside-window')
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const result = assessWeeklyBasketStudy(study)
  assert.ok(result.observationWindowHours > 24)
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.savingsCents, null)
})

function matchingSyntheticPair(candidateUnitCents) {
  const { sheet, csv } = pairedSyntheticInputs(
    '2026-10-04T12:00:00Z', '2026-10-04T13:00:00Z',
  )
  const rows = parseM3FieldCsv(csv)
  for (let i = 1; i <= 22; i++) {
    const side = i <= 11 ? 'baseline' : 'candidate'
    const index = (i - 1) % 11
    const requirement = sheet.requirements[index]
    const observed = sheet[side].lines[index].observedProduct
    const cents = side === 'baseline' ? 200 : candidateUnitCents
    Object.assign(observed, {
      productId: `${side}-fictional-${requirement.id}`,
      productName: requirement.query,
      packAmount: requirement.amount,
      packUnit: requirement.unit,
      packCount: 1,
      priceCents: cents,
      available: true,
      sourceUrl: '',
      note: 'Synthetic test fixture; not a product price.',
    })
    rows[i][9] = requirement.query
    rows[i][10] = String(requirement.amount)
    rows[i][11] = requirement.unit
    rows[i][12] = '1'
    rows[i][13] = String(cents)
    rows[i][14] = 'ja'
  }
  const filledCsv = rows.map(row => row.map(value =>
    '"' + String(value).replaceAll('"', '""') + '"'
  ).join(',')).join('\n') + '\n'
  return { sheet, csv: filledCsv }
}

for (const [expectedOutcome, candidateUnitCents, expectedSavingsCents] of [
  ['better', 100, 1100],
  ['same', 200, 0],
  ['worse', 300, -1100],
]) {
  test(`M3 integrated synthetic full basket: ${expectedOutcome} is financially correct but never a public claim`, () => {
    const { sheet, csv } = matchingSyntheticPair(candidateUnitCents)
    assert.equal(review(csv).status, 'requires-canonical-human-verification')
    assert.equal(observationSheetReadiness(sheet).ready, true)
    const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
    assert.equal(study.baseline.basket.matchedLineCount, 11)
    assert.equal(study.candidate.basket.matchedLineCount, 11)
    const report = buildObservedWeekReport(study)
    assert.equal(report.outcome, expectedOutcome)
    assert.equal(report.claimable, true) // mathematical comparison gate, NOT human proof
    assert.equal(report.savingsCents, expectedSavingsCents)
    assert.equal(report.deltaCents, expectedSavingsCents === 0 ? 0 : -expectedSavingsCents)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.priceContext, 'in-store')
    assert.ok(report.evidenceBoundary.includes('never sufficient'))
    assert.ok(!Object.hasOwn(report, 'participantKey'))
  })
}
