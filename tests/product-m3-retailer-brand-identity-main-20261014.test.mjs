import assert from 'node:assert/strict'
import test from 'node:test'

import {
  observationSheetReadiness,
  observationStoreMatchesExpectedRetailer,
} from '../src/domain/m3ObservationSheet.ts'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

// No human observations, actual store location, retail quote or real savings.
const reviewerClock = Date.parse('2026-10-14T12:00:00Z')

test('M3 store names accept complete authentic retailer brand tokens and branch qualifiers', () => {
  for (const name of ['PLUS', 'PLUS Leiden', 'plus Haarlem', 'Plús Noord']) {
    assert.equal(observationStoreMatchesExpectedRetailer('baseline', name), true, name)
    assert.equal(observationStoreMatchesExpectedRetailer('candidate', name), false, name)
  }
  for (const name of [
    'DekaMarkt', 'Deka Markt', 'Deka-Markt Haarlem',
    'dekamarkt leiden', 'Déká Márkt Noord',
  ]) {
    assert.equal(observationStoreMatchesExpectedRetailer('candidate', name), true, name)
    assert.equal(observationStoreMatchesExpectedRetailer('baseline', name), false, name)
  }
})

test('M3 store identity refuses substrings, contradictory brands and runtime invalid labels', () => {
  for (const name of [
    'NotDekaMarkt', 'SuperDekaMarktFake', 'dekamarktish',
    'DekaMarktPlus', 'PLUS DekaMarkt fake', 'Deka Markt PLUS', 'Deka',
  ]) {
    assert.equal(observationStoreMatchesExpectedRetailer('candidate', name), false, name)
  }
  for (const name of [
    'NotPLUS', 'PlusPlus', 'PLUS DekaMarkt fake', 'DEKAMARKT PLUS',
  ]) {
    assert.equal(observationStoreMatchesExpectedRetailer('baseline', name), false, name)
  }
  assert.equal(observationStoreMatchesExpectedRetailer('candidate', null), false)
  assert.equal(observationStoreMatchesExpectedRetailer('other', 'DekaMarkt'), false)
})

test('fully fictional 22-line field collection refuses spoofed retailer and stays immutable', () => {
  for (const [side, spoof] of [
    ['baseline', 'NotPLUS'],
    ['baseline', 'PLUS DekaMarkt fake'],
    ['candidate', 'NotDekaMarkt'],
    ['candidate', 'SuperDekaMarktFake'],
    ['candidate', 'dekamarktish'],
    ['candidate', 'PLUS DekaMarkt fake'],
  ]) {
    const sheet = buildFictionalPricedSheet()
    sheet[side].store.name = spoof
    const before = JSON.stringify(sheet)
    const ready = observationSheetReadiness(sheet, reviewerClock)
    assert.equal(ready.ready, false, spoof)
    assert.ok(ready.issues.some(issue => issue.includes('winkelnaam moet')), spoof)
    assert.throws(() => buildWeeklyBasketStudyFromObservationSheet(sheet),
      /store\.name|PLUS|DekaMarkt|retailer/i,
      'canonical JSON conversion must independently refuse spoofing')
    assert.equal(JSON.stringify(sheet), before)
  }
})

test('correct named stores retain full private report positive with no public savings claim', () => {
  const sheet = buildFictionalPricedSheet()
  sheet.baseline.store.name = 'PLUS Leiden synthetic'
  sheet.candidate.store.name = 'Deka Markt Haarlem synthetic'
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const report = buildObservedWeekReport(study)
  assert.equal(report.claimable, true)
  assert.equal(report.outcome, 'better')
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(Object.hasOwn(report, 'participantKey'), false)
})
