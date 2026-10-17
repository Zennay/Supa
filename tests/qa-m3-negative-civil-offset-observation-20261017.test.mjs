/**
 * Independent M3 manual field quality validation: a physically impossible
 * UTC-13/UTC-14 *negative* offset is not a human observation timezone.
 * Entirely fictional 11+11 unavailable test rows: no observed prices.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildObservationSheet, validObservedAt } from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

const NOW = Date.parse('2026-10-17T06:00:00.000Z')
function blankPairedSheet() {
  const sheet=buildObservationSheet()
  Object.assign(sheet.study,{
    studyId:'synthetic-utc-offset-check',
    participantKey:'synthetic-participant-offset',
    population:'fictional students',
    region:'fictional region',
    weekStart:'2026-10-05',
    priceContext:'in-store'
  })
  for (const [side,store,time] of [
    ['baseline','PLUS synthetic store','2026-10-06T10:00:00+14:00'],
    ['candidate','DekaMarkt synthetic store','2026-10-06T11:00:00+14:00']
  ]) {
    const obs=sheet[side]
    obs.evidenceId='synthetic-'+side
    obs.observedAt=time
    obs.provenanceNote='FICTIONAL TEST ONLY; not retailer data'
    obs.store={id:'synthetic-'+side,name:store}
    obs.lines.forEach(line=>{line.observedProduct.available=false})
  }
  return sheet
}
test('control: physical UTC-12:00 boundary parses past observation',()=>{
  assert.notEqual(validObservedAt('2026-10-06T10:00:00-12:00',NOW),null)
})
test('control: physical UTC+14:00 boundary forms an unresolved-only paired basket',()=>{
  const study=buildWeeklyBasketStudyFromObservationSheet(blankPairedSheet())
  const report=buildObservedWeekReport(study)
  assert.equal(report.publicSavingsClaimEligible,false)
  assert.equal(report.outcome,'unknown')
})
test('expected RED: -13:00 must never certify a physical manual capture clock',()=>{
  assert.equal(validObservedAt('2026-10-06T10:00:00-13:00',NOW),null)
})
test('expected RED: -14:00 must never certify a physical manual capture clock',()=>{
  assert.equal(validObservedAt('2026-10-06T10:00:00-14:00',NOW),null)
})
test('expected RED: PLUS manual collection with UTC-13:00 must fail converter',()=>{
  const sheet=blankPairedSheet()
  sheet.baseline.observedAt='2026-10-06T10:00:00-13:00'
  assert.throws(()=>buildWeeklyBasketStudyFromObservationSheet(sheet),/observedAt|time|offset|timestamp/i)
})
test('expected RED: DekaMarkt manual collection with UTC-14:00 must fail converter',()=>{
  const sheet=blankPairedSheet()
  sheet.candidate.observedAt='2026-10-06T11:00:00-14:00'
  assert.throws(()=>buildWeeklyBasketStudyFromObservationSheet(sheet),/observedAt|time|offset|timestamp/i)
})
