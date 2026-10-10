import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet, observationSheetReadiness } from '../src/domain/m3ObservationSheet.ts'
import { observationNextAction } from '../src/features/observation/observationNextStep.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'

// Real converter vs. real task-first observation guidance. All fields are
// synthetic, intentionally marked unavailable; no shop prices or field
// evidence are invented, and a successful export is never savings proof.
function completeSyntheticSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-study-synthetic',
    participantKey: 'anonymous-qa',
    population: 'Uitwonende studenten',
    region: 'Leiden',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })
  for (const [side, storeName, observedAt] of [
    ['baseline', 'PLUS Leiden', '2026-10-10T09:00:00Z'],
    ['candidate', 'DekaMarkt Leiden', '2026-10-10T10:00:00Z'],
  ]) {
    Object.assign(sheet[side], {
      evidenceId: side + '-evidence-synthetic',
      observedAt,
      provenanceNote: 'Synthetische QA-casus, geen echte winkelmeting',
      store: { id: side + '-leiden', name: storeName },
    })
    for (const line of sheet[side].lines) line.observedProduct.available = false
  }
  return sheet
}

test('positive: original synthetic canonical field sheet is converter-ready without claiming savings', () => {
  const sheet = completeSyntheticSheet()
  const snapshot = structuredClone(sheet)
  assert.equal(observationSheetReadiness(sheet).ready, true)
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  assert.ok(study)
  assert.equal(observationNextAction(sheet).stage, 'export')
  assert.match(observationNextAction(sheet).detail, /nog geen besparing/)
  assert.deepEqual(sheet, snapshot)
})

test('negative: task guidance must not offer export if the real converter rejects sheet identity', async (t) => {
  const mutations = [
    ['tampered evidence-status contract', (sheet) => { sheet.evidenceStatus = 'verified' }],
    ['tampered selected-meal count', (sheet) => { sheet.selectedMealCount += 1 }],
    ['tampered canonical ingredient quantity', (sheet) => { sheet.requirements[0].amount += 1 }],
    ['tampered candidate line demand', (sheet) => { sheet.candidate.lines[0].requirement.amount += 1 }],
    ['unapproved provenance/source', (sheet) => { sheet.baseline.source = 'browser-cache' }],
    ['loosened 24h maximum with 25h observations', (sheet) => {
      sheet.study.maxObservationWindowHours = 48
      sheet.candidate.observedAt = '2026-10-11T10:00:00Z'
    }],
  ]
  for (const [name, modify] of mutations) {
    await t.test(name, () => {
      const sheet = completeSyntheticSheet()
      modify(sheet)
      const snapshot = structuredClone(sheet)
      assert.throws(
        () => buildWeeklyBasketStudyFromObservationSheet(sheet),
        /./,
        name + ': canonical converter must reject changed observation contract',
      )
      const action = observationNextAction(sheet)
      assert.notEqual(action.stage, 'export',
        name + ': do not tell collectors an unusable sheet is ready to export')
      assert.equal(action.stage, 'review',
        name + ': present a safe check/recollection instruction')
      assert.doesNotMatch(action.title + ' ' + action.detail, /bewezen besparing/i)
      assert.deepEqual(sheet, snapshot, name + ': guidance must never rewrite field observations')
    })
  }
})

test('negative: mismatched same-demand sheet must remain non-exportable even without missing lines', () => {
  const sheet = completeSyntheticSheet()
  sheet.requirements.reverse()
  const snapshot = structuredClone(sheet)
  assert.throws(() => buildWeeklyBasketStudyFromObservationSheet(sheet))
  assert.equal(observationNextAction(sheet).stage, 'review')
  assert.deepEqual(sheet, snapshot)
})
