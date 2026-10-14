import assert from 'node:assert/strict'
import test from 'node:test'
import { buildObservationSheet, observationSheetReadiness, observationWindowSummary } from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'

// Independent cross-path QA of future *absolute instants*, not calendar labels.
// Inputs and all money amounts are fictional; no retailer observations/claims.
function fictionalReadySheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-clock-instant-proof',
    participantKey: 'fictional-no-participant',
    population: 'fictional only',
    region: 'fictional region',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
  })
  for (const [side, name, storeId, priceDelta, at] of [
    ['baseline', 'PLUS fictional', 'plus-fictional', 20, '2026-10-04T12:00:00Z'],
    ['candidate', 'DekaMarkt fictional', 'deka-fictional', 0, '2026-10-04T13:00:00Z'],
  ]) {
    const observed = sheet[side]
    Object.assign(observed, {
      evidenceId: side + '-fictional-clock',
      observedAt: at,
      store: { id: storeId, name },
      source: 'manual-cart',
      provenanceNote: 'Entirely fictional QA-only values.',
    })
    observed.lines.forEach((line, index) => {
      const demand = sheet.requirements[index]
      line.observedProduct = {
        productId: storeId + '-' + demand.id,
        productName: demand.query,
        packAmount: demand.amount,
        packUnit: demand.unit,
        packCount: 1,
        priceCents: 120 + priceDelta + index,
        available: true,
        sourceUrl: '',
        note: 'Fictional QA fixture, not field evidence.',
      }
    })
  }
  return sheet
}

test('M3 QA past absolute instants with different local offsets retain trustworthy comparison', () => {
  const sheet = fictionalReadySheet()
  sheet.baseline.observedAt = '2026-10-04T14:00:00+02:00'
  sheet.candidate.observedAt = '2026-10-04T08:00:00-05:00'
  const ready = observationSheetReadiness(sheet)
  assert.equal(ready.ready, true, ready.issues.join('; '))
  assert.equal(observationWindowSummary(sheet).state, 'within-window')
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const result = assessWeeklyBasketStudy(study)
  assert.equal(result.claimable, true)
  assert.equal(result.comparison.outcome, 'better')
  assert.equal(result.comparison.claimable, true)
})

for (const side of ['baseline', 'candidate']) {
  test(`M3 QA future actual instant must abstain at collector, converter and direct finance for ${side}`, () => {
    for (const futureAt of [
      '2099-10-10T02:00:00+14:00',
      '2099-10-10T02:00:00-12:00',
      '2099-10-09T23:30:00-10:00',
    ]) {
      const sheet = fictionalReadySheet()
      sheet[side].observedAt = futureAt
      const readiness = observationSheetReadiness(sheet)
      assert.equal(readiness.ready, false, side + ': ' + futureAt)
      assert.ok(readiness.issues.some(reason => /observatietijd/u.test(reason)), side + ': ' + futureAt)
      assert.notEqual(observationWindowSummary(sheet).state, 'within-window')
      assert.throws(
        () => buildWeeklyBasketStudyFromObservationSheet(sheet),
        { message: side + '.observedAt must be a valid timestamp' },
        side + ': ' + futureAt,
      )
      // Direct study API cannot convert a future capture into savings by
      // bypassing the canonical collector/converter validation.
      const validPast = buildWeeklyBasketStudyFromObservationSheet(fictionalReadySheet())
      validPast[side].observedAt = futureAt
      const result = assessWeeklyBasketStudy(validPast)
      assert.equal(result.claimable, false, side + ': ' + futureAt)
      assert.equal(result.comparison.claimable, false)
      assert.equal(result.comparison.outcome, 'unknown')
      assert.equal(result.comparison.deltaCents, null)
      assert.equal(result.comparison.savingsCents, null)
      assert.ok(result.reasons.some(reason => reason.includes(side + ' observedAt is not a valid timestamp')))
    }
  })
}

test('M3 QA a wholly future one-hour pair is not a valid observed 24-hour window', () => {
  const sheet = fictionalReadySheet()
  sheet.baseline.observedAt = '2099-10-10T12:00:00Z'
  sheet.candidate.observedAt = '2099-10-10T08:00:00-05:00'
  const ready = observationSheetReadiness(sheet)
  assert.equal(ready.ready, false)
  assert.notEqual(observationWindowSummary(sheet).state, 'within-window')
  assert.throws(() => buildWeeklyBasketStudyFromObservationSheet(sheet), /observedAt must be a valid timestamp/u)
  const pastStudy = buildWeeklyBasketStudyFromObservationSheet(fictionalReadySheet())
  pastStudy.baseline.observedAt = sheet.baseline.observedAt
  pastStudy.candidate.observedAt = sheet.candidate.observedAt
  const assessment = assessWeeklyBasketStudy(pastStudy)
  assert.equal(assessment.claimable, false)
  assert.equal(assessment.comparison.outcome, 'unknown')
  assert.equal(assessment.comparison.savingsCents, null)
  assert.ok(assessment.reasons.some(reason => reason.includes('baseline observedAt is not a valid timestamp')))
  assert.ok(assessment.reasons.some(reason => reason.includes('candidate observedAt is not a valid timestamp')))
})


test('M3 QA historical DST fallback exactly 24h is accepted on both observation paths', () => {
  const sheet = fictionalReadySheet()
  sheet.study.weekStart = '2025-10-27'
  // 12:00 +02 and 11:00 +01 across the real Amsterdam autumn DST shift:
  // exact elapsed UTC time is 24h, despite the local wall clock differing.
  sheet.baseline.observedAt = '2025-10-25T12:00:00+02:00'
  sheet.candidate.observedAt = '2025-10-26T11:00:00+01:00'
  const status = observationSheetReadiness(sheet)
  assert.equal(status.ready, true, status.issues.join('; '))
  const window = observationWindowSummary(sheet)
  assert.equal(window.state, 'within-window')
  assert.equal(window.deltaHours, 24)
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const result = assessWeeklyBasketStudy(study)
  assert.equal(result.claimable, true)
  assert.equal(result.observationWindowHours, 24)
  assert.equal(result.comparison.outcome, 'better')
})

test('M3 QA historical DST fallback 24h plus one millisecond never becomes savings', () => {
  const sheet = fictionalReadySheet()
  sheet.study.weekStart = '2025-10-27'
  sheet.baseline.observedAt = '2025-10-25T12:00:00+02:00'
  sheet.candidate.observedAt = '2025-10-26T11:00:00.001+01:00'
  assert.equal(observationSheetReadiness(sheet).ready, false)
  assert.equal(observationWindowSummary(sheet).state, 'outside-window')
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const result = assessWeeklyBasketStudy(study)
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.savingsCents, null)
  assert.ok(result.observationWindowHours > 24)
})
