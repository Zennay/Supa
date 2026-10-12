import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationLineCollectionComplete,
  observationSheetProgress,
  observationSheetReadiness,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

// Independent, controlled M2-demand fixture. No real retailer observations,
// identifiable participant records, retailer prices, or public savings proof.
function fictionalCompleteSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-m3-supplementary-unicode',
    participantKey: 'pseudonymous-fixture-only',
    population: 'Uitwonende studenten',
    region: 'Leiden (fictieve testcase)',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })
  for (const [side, storeId, storeName, date, markup] of [
    ['baseline', 'qa-plus-supplement', 'PLUS fictieve winkel',
      '2026-10-05T10:00:00.000Z', 5],
    ['candidate', 'qa-dekamarkt-supplement', 'DekaMarkt fictieve winkel',
      '2026-10-05T11:00:00.000Z', 0],
  ]) {
    const shop = sheet[side]
    shop.evidenceId = side + '-qa-supplementary'
    shop.observedAt = date
    shop.source = 'manual-cart'
    shop.provenanceNote = 'Synthetische test, geen winkelbezoek'
    shop.store = { id: storeId, name: storeName }
    shop.lines.forEach((line, index) => {
      const requirement = sheet.requirements[index]
      line.observedProduct = {
        available: true,
        productId: storeId + '-' + requirement.id,
        productName: requirement.query,
        packAmount: requirement.amount,
        packUnit: requirement.unit,
        packCount: 1,
        priceCents: 100 + index + markup,
        sourceUrl: '',
        note: 'Testfixture, geen verkoopprijs',
      }
    })
  }
  return sheet
}

const invisibleOnlyCases = [
  ['supplementary variation selector-17', '\u{E0100}'],
  ['supplementary language tag', '\u{E0001}'],
  ['supplementary cancel tag', '\u{E007F}'],
  ['supplementary combining Byzantine mark', '\u{1D185}'],
  ['Khmer inherent vowel sign', '\u17B4'],
  ['Mongolian vowel separator', '\u180E'],
  ['mixed format, combining and supplementary marks',
    '\u{E0100}\u17B4\u180E\u200D\u{E007F}'],
]

for (const [label, invisible] of invisibleOnlyCases) {
  for (const [location, field] of [
    ['study', 'population'],
    ['study', 'region'],
    ['baseline', 'provenanceNote'],
    ['candidate', 'provenanceNote'],
  ]) {
    test(`M3 supplementary Unicode: ${label} cannot complete ${location}.${field}`, () => {
      const sheet = fictionalCompleteSheet()
      sheet[location][field] = invisible
      const unchanged = JSON.stringify(sheet)
      const restored = restoreObservationSheetDraft(unchanged)
      assert.ok(restored, 'JSON draft must remain recoverable')
      assert.equal(observationSheetProgress(restored).metadataCompleted, 15)
      assert.equal(observationSheetReadiness(restored).ready, false)
      assert.equal(JSON.stringify(sheet), unchanged)

      // The canonical converter is allowed to reject unsafe collection.
      // If it returns a study, the assessor/report must abstain from money.
      let study
      try {
        study = buildWeeklyBasketStudyFromObservationSheet(restored)
      } catch {
        return
      }
      const assessed = assessWeeklyBasketStudy(study)
      const report = buildObservedWeekReport(study)
      assert.equal(assessed.claimable, false)
      assert.equal(assessed.comparison.outcome, 'unknown')
      assert.equal(assessed.comparison.savingsCents, null)
      assert.equal(assessed.comparison.deltaCents, null)
      assert.deepEqual(assessed.comparison.lineDeltas, [])
      assert.equal(report.claimable, false)
      assert.equal(report.outcome, 'unknown')
      assert.equal(report.savingsCents, null)
      assert.equal(report.deltaCents, null)
      assert.equal(report.publicSavingsClaimEligible, false)
      assert.equal(Object.hasOwn(report, 'participantKey'), false)
      assert.doesNotMatch(JSON.stringify(report), /pseudonymous-fixture-only/)
    })
  }

  test(`M3 supplementary Unicode: ${label} cannot complete product observation`, () => {
    const sheet = fictionalCompleteSheet()
    sheet.candidate.lines[0].observedProduct.productName = invisible
    const before = JSON.stringify(sheet)
    const restored = restoreObservationSheetDraft(before)
    assert.ok(restored)
    assert.equal(observationLineCollectionComplete(restored.candidate.lines[0]), false)
    assert.equal(observationSheetProgress(restored).completeLines, 21)
    assert.equal(observationSheetReadiness(restored).ready, false)
    assert.equal(JSON.stringify(sheet), before)
  })
}

test('M3 preserves readable RTL, Hangul, emoji joins and decomposed accents', () => {
  const sheet = fictionalCompleteSheet()
  sheet.study.population = '👩\u200D🍳 uitwonende studenten'
  sheet.study.region = '서울, القاهرة en Leiden'
  sheet.baseline.provenanceNote = 'Caf' + 'e\u0301' + ' testnotitie'
  sheet.candidate.provenanceNote = '🧾 gecontroleerd (synthetisch)'
  sheet.baseline.lines[0].observedProduct.productName = '쌀 🍚'
  const before = JSON.stringify(sheet)
  const restored = restoreObservationSheetDraft(before)
  assert.ok(restored)
  assert.deepEqual(observationSheetReadiness(restored), { ready: true, issues: [] })
  assert.equal(observationSheetProgress(restored).completeLines, 22)
  const study = buildWeeklyBasketStudyFromObservationSheet(restored)
  const assessed = assessWeeklyBasketStudy(study)
  const report = buildObservedWeekReport(study)
  assert.equal(assessed.claimable, true)
  assert.equal(report.claimable, true)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(Object.hasOwn(report, 'participantKey'), false)
  assert.equal(JSON.stringify(sheet), before)
})
