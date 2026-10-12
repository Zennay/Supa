import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import {
  observationSheetProgress,
  observationSheetReadiness,
} from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

// All 22 line prices and product names are fictitious. The canonical M2
// requirements are used unchanged; these are never field observations.
function completedSyntheticSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-m3-context-cross-layer-20261012',
    participantKey: 'fictional-student-no-identifiers',
    population: 'uitwonende studenten',
    region: 'Leiden',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })

  for (const [side, storeId, storeName, offset] of [
    ['baseline', 'qa-plus-field', 'PLUS testwinkel', 15],
    ['candidate', 'qa-dekamarkt-field', 'DekaMarkt testwinkel', 0],
  ]) {
    const observation = sheet[side]
    observation.evidenceId = side + '-qa-m3-context'
    observation.observedAt = side === 'baseline'
      ? '2026-10-05T12:00:00Z' : '2026-10-05T13:00:00Z'
    observation.source = 'manual-cart'
    observation.provenanceNote = 'Fictieve QA-observatie, geen echte winkeldata.'
    observation.store = { id: storeId, name: storeName }
    observation.lines.forEach((line, index) => {
      const required = sheet.requirements[index]
      line.observedProduct = {
        available: true,
        productId: storeId + '-' + required.id,
        productName: required.query,
        packAmount: required.amount,
        packUnit: required.unit,
        packCount: 1,
        priceCents: 100 + index + offset,
        sourceUrl: '',
        note: 'Testfixture only',
      }
    })
  }
  return sheet
}

test('M3 cross-layer: readable synthetic observed data remains internally claimable, never publicly', () => {
  const sheet = completedSyntheticSheet()
  const original = JSON.stringify(sheet)
  const readiness = observationSheetReadiness(sheet)
  assert.deepEqual(readiness, { ready: true, issues: [] })
  assert.equal(observationSheetProgress(sheet).completeLines, 22)

  const study = buildWeeklyBasketStudyFromObservationSheet(JSON.parse(original))
  const assessment = assessWeeklyBasketStudy(study)
  const report = buildObservedWeekReport(study)
  assert.equal(assessment.claimable, true)
  assert.equal(assessment.comparison.outcome, 'better')
  assert.equal(report.claimable, true)
  assert.equal(report.outcome, 'better')
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal('participantKey' in report, false)
  assert.equal(assessment.observationWindowHours, 1)
  assert.equal(JSON.stringify(sheet), original)
})

for (const [path, invisible] of [
  ['study.population', '\u200B\u034F'],
  ['study.region', '\u115F\u1160\u2800'],
  ['baseline.provenanceNote', '\uFFA0\u200D'],
  ['candidate.provenanceNote', '\u3164\u0301\u2800'],
]) {
  test('M3 cross-layer never promotes blank evidence field: ' + path, () => {
    const sheet = completedSyntheticSheet()
    const [part, key] = path.split('.')
    sheet[part][key] = invisible
    const original = JSON.stringify(sheet)

    const progress = observationSheetProgress(sheet)
    assert.equal(progress.metadataCompleted, progress.metadataTotal - 1)
    assert.equal(observationSheetReadiness(sheet).ready, false)

    // The converter may conservatively reject the malformed JSON, or pass
    // it to the assessment gate, which must then reject the money claim.
    let study
    try {
      study = buildWeeklyBasketStudyFromObservationSheet(JSON.parse(original))
    } catch {
      assert.equal(JSON.stringify(sheet), original)
      return
    }

    const assessment = assessWeeklyBasketStudy(study)
    assert.equal(assessment.claimable, false)
    assert.equal(assessment.comparison.outcome, 'unknown')
    assert.equal(assessment.comparison.savingsCents, null)
    assert.equal(assessment.comparison.deltaCents, null)
    assert.deepEqual(assessment.comparison.lineDeltas, [])
    const report = buildObservedWeekReport(study)
    assert.equal(report.claimable, false)
    assert.equal(report.outcome, 'unknown')
    assert.equal(report.savingsCents, null)
    assert.equal(report.deltaCents, null)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal('participantKey' in report, false)
    assert.equal(JSON.stringify(sheet), original)
  })
}
