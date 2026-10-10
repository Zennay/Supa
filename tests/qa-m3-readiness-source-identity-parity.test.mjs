import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationSheetReadiness,
  observationSheetProgress,
} from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'

// Synthetic contract verification. These are not actual PLUS/DekaMarkt prices,
// products, source evidence, or participant observations for M3 issue #78.
const SOURCE_TYPES = ['manual-cart', 'receipt', 'consented-export']

function completeSyntheticSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-source-check-001',
    participantKey: 'qa-student-pseudo',
    population: 'Synthetic quality control',
    region: 'synthetic-test',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })

  for (const side of ['baseline', 'candidate']) {
    const observation = sheet[side]
    observation.evidenceId = side + '-synthetic-proof'
    observation.observedAt = side === 'baseline'
      ? '2026-10-05T09:00:00Z'
      : '2026-10-05T10:00:00Z'
    observation.source = 'manual-cart'
    observation.provenanceNote = 'Synthetic QA only, not field collection'
    observation.store = {
      id: side + '-synthetic-store',
      name: side === 'baseline' ? 'PLUS synthetic' : 'DekaMarkt synthetic',
    }

    observation.lines.forEach((line, index) => {
      const requirement = sheet.requirements[index]
      line.observedProduct = {
        available: true,
        productId: side + '-synthetic-' + requirement.id,
        productName: requirement.query,
        packAmount: requirement.amount,
        packUnit: requirement.unit,
        packCount: 1,
        priceCents: 100 + index,
        sourceUrl: '',
        note: 'No real retailer evidence',
      }
    })
  }

  return sheet
}

test('M3 readiness/source contract accepts each permitted source pair without changing source provenance', () => {
  let verified = 0
  for (const priceContext of ['in-store', 'online-order']) {
    for (const baselineSource of SOURCE_TYPES) {
      for (const candidateSource of SOURCE_TYPES) {
        const sheet = completeSyntheticSheet()
        sheet.study.priceContext = priceContext
        sheet.baseline.source = baselineSource
        sheet.candidate.source = candidateSource
        const snapshot = structuredClone(sheet)

        assert.deepEqual(observationSheetReadiness(sheet), { ready: true, issues: [] })
        const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
        assert.equal(study.baseline.source, baselineSource)
        assert.equal(study.candidate.source, candidateSource)
        assert.equal(study.priceContext, priceContext)
        const assessment = assessWeeklyBasketStudy(study)
        assert.equal(assessment.claimable, true)
        assert.deepEqual(sheet, snapshot)
        verified++
      }
    }
  }
  assert.equal(verified, 18)
})

test('M3 readiness cannot tell the collector to export an unapproved source', () => {
  for (const side of ['baseline', 'candidate']) {
    for (const badSource of ['browser-cache', 'fabricated-offer', null, '', 42]) {
      const sheet = completeSyntheticSheet()
      sheet[side].source = badSource
      const snapshot = structuredClone(sheet)
      const progress = observationSheetProgress(sheet)
      assert.equal(progress.completeLines, 22, 'separate product completeness must remain intact')
      assert.throws(
        () => buildWeeklyBasketStudyFromObservationSheet(sheet),
        new RegExp(side + '\\.source is not an allowed observed source'),
      )

      const result = observationSheetReadiness(sheet)
      assert.equal(result.ready, false, side + ' source ' + String(badSource))
      assert.ok(result.issues.some((issue) => /bron|source|herkomst/i.test(issue)),
        side + ': supply an actionable source reason')
      assert.deepEqual(sheet, snapshot, 'preflight must not rewrite provenance')
    }
  }
})

test('M3 readiness refuses duplicate evidence IDs before marking collection export-ready', () => {
  const sheet = completeSyntheticSheet()
  sheet.candidate.evidenceId = sheet.baseline.evidenceId
  const snapshot = structuredClone(sheet)

  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const assessment = assessWeeklyBasketStudy(study)
  assert.equal(assessment.claimable, false, 'downstream rightly rejects reused evidence identities')
  assert.equal(assessment.comparison.outcome, 'unknown')
  assert.equal(assessment.comparison.deltaCents, null)
  assert.equal(assessment.comparison.savingsCents, null)

  const result = observationSheetReadiness(sheet)
  assert.equal(result.ready, false)
  assert.match(result.issues.join(' '), /evidence|bewij|duplicaat|verschil/i)
  assert.deepEqual(sheet, snapshot)
})
