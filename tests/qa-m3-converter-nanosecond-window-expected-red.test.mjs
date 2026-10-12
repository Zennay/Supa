import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

// Independent transport path for the same expected-RED timing fault:
// controlled observation sheet -> canonical converter -> parsed JSON -> M3
// report. Invented synthetic prices are not retailer evidence.
function makeSyntheticSheet(baselineAt, candidateAt) {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-nanosecond-converter',
    participantKey: 'qa-anonymous-synthetic',
    population: 'Synthetic QA only',
    region: 'Leiden',
    weekStart: '2026-10-19',
    priceContext: 'in-store',
  })
  for (const [side, name, storeId, offset] of [
    ['baseline', 'PLUS synthetic', 'qa-plus-nano', 10],
    ['candidate', 'DekaMarkt synthetic', 'qa-deka-nano', 0],
  ]) {
    const observation = sheet[side]
    observation.store = { id: storeId, name }
    observation.evidenceId = `${side}-nano-proof`
    observation.observedAt = side === 'baseline' ? baselineAt : candidateAt
    observation.source = 'manual-cart'
    observation.provenanceNote = 'Generated synthetic unit-test values; not observed prices'
    observation.lines.forEach((line, index) => {
      const requirement = sheet.requirements[index]
      line.observedProduct = {
        productId: `${storeId}-item-${index}`,
        productName: requirement.query,
        packAmount: requirement.amount,
        packUnit: requirement.unit,
        packCount: 1,
        priceCents: 100 + index + offset,
        available: true,
        sourceUrl: '',
        note: 'Synthetic unit-test values only',
      }
    })
  }
  return sheet
}

function transportAssessment(baselineAt, candidateAt) {
  const sheet = makeSyntheticSheet(baselineAt, candidateAt)
  const original = JSON.stringify(sheet)
  const converted = buildWeeklyBasketStudyFromObservationSheet(
    JSON.parse(JSON.stringify(sheet)),
  )
  assert.equal(converted.baseline.basket.matchedLineCount, 11)
  assert.equal(converted.candidate.basket.matchedLineCount, 11)
  assert.equal(JSON.stringify(sheet), original)

  const report = buildObservedWeekReport(JSON.parse(JSON.stringify(converted)))
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal('participantKey' in report, false)
  assert.doesNotMatch(JSON.stringify(report), /qa-anonymous-synthetic/)
  return { converted, report }
}

test('EXPECTED RED: converter transport must not turn 24h plus 1ns into claimable savings', () => {
  const { report } = transportAssessment(
    '2026-10-24T16:00:00.000000000Z',
    '2026-10-25T16:00:00.000000001Z',
  )
  assert.equal(report.claimable, false)
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.deltaCents, null)
  assert.equal(report.savingsCents, null)
  assert.equal(report.attribution.status, 'unknown')
})

test('POSITIVE: converter accepts exact 24h with nine-digit trailing zeros', () => {
  const { converted, report } = transportAssessment(
    '2026-10-24T18:00:00.000000000+02:00',
    '2026-10-25T17:00:00.000000000+01:00',
  )
  assert.equal(report.claimable, true)
  assert.equal(report.observationWindowHours, 24)
  assert.equal(report.outcome, 'better')
  assert.equal(
    report.deltaCents,
    converted.candidate.basket.totalCents - converted.baseline.basket.totalCents,
  )
  assert.equal(report.savingsCents, -report.deltaCents)
})
