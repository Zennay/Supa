import assert from 'node:assert/strict'
import test from 'node:test'
import { buildObservationSheet, observationSheetReadiness } from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

// Independent paper -> canonical converter -> observed report on actual merged M3.
// Synthetic observations only; never merchant evidence or a public savings claim.
function fictionalPairedPaper({ baselinePriceCents = 250, candidatePriceCents = 200 } = {}) {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa_paper_report_20261015',
    participantKey: 'synthetic_not_a_person',
    population: 'synthetic student cohort',
    region: 'fictional store region',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
  })
  for (const [side, name, hour, unitPrice] of [
    ['baseline', 'PLUS', '10', baselinePriceCents],
    ['candidate', 'DekaMarkt', '11', candidatePriceCents],
  ]) {
    const obs = sheet[side]
    obs.evidenceId = 'qa_evidence_' + side
    obs.observedAt = '2026-10-14T' + hour + ':00:00Z'
    obs.source = 'manual-cart'
    obs.provenanceNote = 'Fictional offline comparison only for ' + side
    obs.store = { id: 'synthetic_' + side, name }
    for (const [index, line] of obs.lines.entries()) {
      const requirement = sheet.requirements[index]
      line.observedProduct = {
        productId: 'qa_' + side + '_' + requirement.id,
        productName: requirement.query,
        packAmount: requirement.amount,
        packUnit: requirement.unit,
        packCount: 1,
        priceCents: unitPrice,
        available: true,
        sourceUrl: '',
        note: 'fictional price for arithmetic only',
      }
    }
  }
  return sheet
}

function privateReportFromPaper(sheet) {
  assert.deepEqual(observationSheetReadiness(sheet), { ready: true, issues: [] })
  return buildObservedWeekReport(buildWeeklyBasketStudyFromObservationSheet(sheet))
}

test('paper -> canonical -> private M3 report: fictional complete 11x2 candidate cheaper but public savings ALWAYS ineligible', () => {
  const sheet = fictionalPairedPaper()
  const snapshot = structuredClone(sheet)
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  for (const side of ['baseline', 'candidate']) {
    assert.equal(study[side].basket.lines.length, 11)
    assert.equal(study[side].basket.matchedLineCount, 11)
    assert.equal(study[side].basket.unresolvedLineCount, 0)
    assert.ok(study[side].basket.lines.every(line => line.status === 'matched' && line.packs === 1))
  }
  const report = privateReportFromPaper(sheet)
  assert.equal(report.reportType, 'm3-observed-week-assessment')
  assert.equal(report.claimable, true, 'structural one-week comparison only')
  assert.equal(report.outcome, 'better')
  assert.equal(report.baselineTotalCents, 2750)
  assert.equal(report.candidateTotalCents, 2200)
  assert.equal(report.deltaCents, -550)
  assert.equal(report.savingsCents, 550)
  assert.equal(report.observationWindowHours, 1)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.match(report.evidenceBoundary, /never sufficient by itself for a public savings claim/i)
  assert.ok(!Object.hasOwn(report, 'participantKey'), 'private pseudonym is not repeated in report')
  assert.deepEqual(sheet, snapshot, 'canonical conversion and reporting may not rewrite field paper inputs')
})

test('paper -> canonical -> private M3 report: fictional full candidate WORSE must stay visible and negative', () => {
  const report = privateReportFromPaper(fictionalPairedPaper({ candidatePriceCents: 300 }))
  assert.equal(report.outcome, 'worse')
  assert.equal(report.claimable, true, 'technically comparable does not mean profitable')
  assert.equal(report.baselineTotalCents, 2750)
  assert.equal(report.candidateTotalCents, 3300)
  assert.equal(report.deltaCents, 550)
  assert.equal(report.savingsCents, -550)
  assert.equal(report.publicSavingsClaimEligible, false)
})

test('paper -> canonical -> private M3 report: one checked UNAVAILABLE candidate line forces UNKNOWN, never fabricated euros', () => {
  const paper = fictionalPairedPaper()
  const line = paper.candidate.lines[0]
  line.observedProduct = {
    productId: '', productName: '', packAmount: null, packUnit: null,
    packCount: 1, priceCents: null, available: false, sourceUrl: '', note: '',
  }
  const report = privateReportFromPaper(paper)
  assert.equal(report.baseline.matchedLineCount, 11)
  assert.equal(report.candidate.matchedLineCount, 10)
  assert.equal(report.candidate.unresolvedLineCount, 1)
  assert.equal(report.claimable, false)
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.deltaCents, null)
  assert.equal(report.savingsCents, null)
  assert.equal(report.publicSavingsClaimEligible, false)
})

test('paper -> canonical -> private M3 report: same weekly demand but >24h apart MUST remain unclaimable', () => {
  const paper = fictionalPairedPaper()
  // 26h difference, both calendar days within the declared planning week.
  paper.candidate.observedAt = '2026-10-15T12:00:00Z'
  const readiness = observationSheetReadiness(paper)
  assert.equal(readiness.ready, false)
  assert.match(readiness.issues.join(' '), /maximaal 24 uur is toegestaan/)
  const study = buildWeeklyBasketStudyFromObservationSheet(paper)
  const report = buildObservedWeekReport(study)
  assert.equal(report.observationWindowHours, 26)
  assert.equal(report.claimable, false)
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.deltaCents, null)
  assert.equal(report.savingsCents, null)
  assert.equal(report.publicSavingsClaimEligible, false)
})
