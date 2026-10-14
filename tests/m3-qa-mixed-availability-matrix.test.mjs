import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

// All stores, prices, IDs and dates in this suite are fictional. No field capture.
const PRIVATE_CANARY = 'fictional-private-participant-qa-canary'

function makeFictionalSheet(baselineUnavailable, candidateUnavailable, candidatePriceShift) {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-mixed-availability-matrix',
    participantKey: PRIVATE_CANARY,
    population: 'fictional students',
    region: 'fictional region',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })

  for (const [side, unavailableAt, hour] of [
    ['baseline', baselineUnavailable, '10'],
    ['candidate', candidateUnavailable, '11'],
  ]) {
    const observation = sheet[side]
    observation.store = {
      id: side === 'baseline' ? 'fictional-plus' : 'fictional-dekamarkt',
      name: side === 'baseline' ? 'PLUS fictional shop' : 'DekaMarkt fictional shop',
    }
    observation.evidenceId = `fictional-${side}-observation`
    observation.observedAt = `2026-10-06T${hour}:00:00Z`
    observation.source = 'manual-cart'
    observation.provenanceNote = PRIVATE_CANARY

    observation.lines.forEach((line, index) => {
      const requirement = sheet.requirements[index]
      const unavailable = unavailableAt === index
      line.observedProduct = {
        available: !unavailable,
        productId: `fictional-${side}-product-${index}`,
        productName: requirement.query,
        packAmount: requirement.amount,
        packUnit: requirement.unit,
        packCount: 1,
        // Deliberately leave an enticing (but inadmissible) price behind
        // available:false. It MUST NOT be counted as observed money.
        priceCents: unavailable ? 987654 : 100 + index +
          (side === 'candidate' ? candidatePriceShift : 0),
        sourceUrl: '',
        note: 'Fictional fixture. Not a retailer observation.',
      }
    })
  }
  return sheet
}

test('M3: 432 independent 11+11 mixed-availability baskets never promote unknown money to savings', () => {
  const noMissingRow = 11
  let checked = 0
  let incomplete = 0
  let complete = 0

  // 12 x 12 combinations: any one missing row per store, or none.
  // Three different price directions ensure unknown detection is not
  // accidentally coupled to a cheaper/equal/more expensive candidate.
  for (const shift of [-5, 0, 5]) {
    for (let baselineMissing = 0; baselineMissing <= noMissingRow; baselineMissing++) {
      for (let candidateMissing = 0; candidateMissing <= noMissingRow; candidateMissing++) {
        const context = `shift=${shift}, baselineMissing=${baselineMissing}, candidateMissing=${candidateMissing}`
        const sheet = makeFictionalSheet(baselineMissing, candidateMissing, shift)
        assert.equal(sheet.requirements.length, 11, context)
        assert.equal(sheet.baseline.lines.length, 11, context)
        assert.equal(sheet.candidate.lines.length, 11, context)

        const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
        const report = buildObservedWeekReport(study)
        const baselineUnknown = Number(baselineMissing !== noMissingRow)
        const candidateUnknown = Number(candidateMissing !== noMissingRow)

        assert.equal(study.baseline.basket.unresolvedLineCount, baselineUnknown, context)
        assert.equal(study.candidate.basket.unresolvedLineCount, candidateUnknown, context)
        assert.equal(study.baseline.basket.matchedLineCount, 11 - baselineUnknown, context)
        assert.equal(study.candidate.basket.matchedLineCount, 11 - candidateUnknown, context)
        assert.equal(report.publicSavingsClaimEligible, false, context)
        assert.equal('participantKey' in report, false, context)
        assert.equal(JSON.stringify(report).includes(PRIVATE_CANARY), false, context)

        if (baselineUnknown || candidateUnknown) {
          incomplete++
          assert.equal(report.outcome, 'unknown', context)
          assert.equal(report.claimable, false, context)
          assert.equal(report.deltaCents, null, context)
          assert.equal(report.savingsCents, null, context)
          assert.equal(report.attribution.status, 'unknown', context)
        } else {
          complete++
          assert.equal(report.claimable, true, context)
          assert.equal(report.outcome, shift < 0 ? 'better' : shift > 0 ? 'worse' : 'same', context)
          assert.equal(report.deltaCents, shift * 11, context)
        }

        // Neither generation nor reporting is allowed to turn unavailable
        // observations into available measurements in the source sheet.
        if (baselineUnknown) assert.equal(sheet.baseline.lines[baselineMissing].observedProduct.available, false, context)
        if (candidateUnknown) assert.equal(sheet.candidate.lines[candidateMissing].observedProduct.available, false, context)
        checked++
      }
    }
  }

  assert.equal(checked, 432)
  assert.equal(incomplete, 429)
  assert.equal(complete, 3)
})
