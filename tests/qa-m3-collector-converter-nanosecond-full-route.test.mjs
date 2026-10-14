import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet, observationSheetReadiness, observationWindowSummary,
} from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

// End-to-end controlled M2-derived 22-line field sheet. Every product, amount,
// participant key and price is synthetic, NOT an observed retailer saving.
function completeSheet(baselineAt, candidateAt) {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-m3-nano-full-route',
    participantKey: 'synthetic-private-key',
    population: 'Synthetic students', region: 'Fictitious Leiden sample',
    weekStart: '2026-10-05', priceContext: 'in-store',
  })
  for (const [side, name, id, at, extraPrice] of [
    ['baseline', 'PLUS synthetic', 'qa-plus', baselineAt, 10],
    ['candidate', 'DekaMarkt synthetic', 'qa-dekamarkt', candidateAt, 0],
  ]) {
    const record = sheet[side]
    record.evidenceId = side + '-synthetic-nano'
    record.observedAt = at
    record.source = 'manual-cart'
    record.provenanceNote = 'Controlled synthetic prices, never field evidence'
    record.store = { id, name }
    record.lines.forEach((line, index) => {
      const requirement = sheet.requirements[index]
      line.observedProduct = {
        available: true,
        productId: id + '-' + requirement.id,
        productName: requirement.query,
        packAmount: requirement.amount,
        packUnit: requirement.unit,
        packCount: 1,
        priceCents: 100 + index + extraPrice,
        sourceUrl: '', note: 'Unit test only',
      }
    })
  }
  return sheet
}

test('joint #1513/#1823: 24h+1ns cannot turn a ready-looking field sheet into claimable report', () => {
  const sheet = completeSheet(
    '2026-10-08T10:00:00.123000000Z',
    '2026-10-09T10:00:00.123000001Z',
  )
  const snapshot = JSON.stringify(sheet)
  const ready = observationSheetReadiness(sheet)
  assert.equal(ready.ready, false)
  assert.ok(ready.issues.some(x => x.includes('Winkel B') && x.includes('observatietijd')))
  assert.notEqual(observationWindowSummary(sheet).state, 'within-window')
  const study = buildWeeklyBasketStudyFromObservationSheet(JSON.parse(snapshot))
  const assessed = assessWeeklyBasketStudy(study)
  assert.equal(assessed.claimable, false)
  assert.equal(assessed.comparison.outcome, 'unknown')
  assert.equal(assessed.comparison.deltaCents, null)
  assert.equal(assessed.comparison.savingsCents, null)
  assert.deepEqual(assessed.comparison.lineDeltas, [])
  const report = buildObservedWeekReport(study)
  assert.equal(report.claimable, false)
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.deltaCents, null)
  assert.equal(report.savingsCents, null)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(Object.hasOwn(report, 'participantKey'), false)
  assert.doesNotMatch(JSON.stringify(report), /synthetic-private-key/)
  assert.equal(JSON.stringify(sheet), snapshot)
})

test('joint #1513/#1823: exactly 24h and legible required metadata stay privately comparable', () => {
  const sheet = completeSheet(
    '2026-10-24T18:00:00.123000000+02:00',
    '2026-10-25T17:00:00.123000000+01:00',
  )
  sheet.baseline.provenanceNote = 'Leesbaar: cafe\u0301'
  sheet.candidate.provenanceNote = '⠃⠗⠇ geobserveerd? Synthetic only'
  const snapshot = JSON.stringify(sheet)
  assert.deepEqual(observationSheetReadiness(sheet), { ready: true, issues: [] })
  assert.deepEqual(observationWindowSummary(sheet), { state: 'within-window', deltaHours: 24 })
  const study = buildWeeklyBasketStudyFromObservationSheet(JSON.parse(snapshot))
  const report = buildObservedWeekReport(study)
  assert.equal(report.claimable, true)
  assert.equal(report.observationWindowHours, 24)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(Object.hasOwn(report, 'participantKey'), false)
  assert.equal(JSON.stringify(sheet), snapshot)
})
