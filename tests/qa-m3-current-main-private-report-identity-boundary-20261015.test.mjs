import assert from 'node:assert/strict'
import test from 'node:test'
import { buildObservationSheet, observationSheetReadiness } from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

// All names, emails, prices and identities below are synthetic fixtures.
// This is a private report boundary regression, not observation evidence.
function fictionalPair() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'privacy_qa_20261015',
    participantKey: 'fictional_student_key',
    population: 'fictional cohort',
    region: 'fictional area',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
  })
  for (const [side, storeName, hour, price] of [
    ['baseline', 'PLUS', '10', 250],
    ['candidate', 'DekaMarkt', '11', 200],
  ]) {
    const observation = sheet[side]
    observation.evidenceId = 'fictional_evidence_' + side
    observation.observedAt = '2026-10-14T' + hour + ':00:00Z'
    observation.source = 'manual-cart'
    observation.provenanceNote = 'offline synthetic input only'
    observation.store = { id: 'fictional_store_' + side, name: storeName }
    for (const [index, line] of observation.lines.entries()) {
      const requirement = sheet.requirements[index]
      line.observedProduct = {
        productId: 'fictional_' + side + '_' + requirement.id,
        productName: requirement.query,
        packAmount: requirement.amount,
        packUnit: requirement.unit,
        packCount: 1,
        priceCents: price,
        available: true,
        sourceUrl: '',
        note: 'synthetic price only',
      }
    }
  }
  return sheet
}

test('M3 private report: user pseudonym, source URLs and raw provenance do not cross the aggregate publication boundary', () => {
  const sheet = fictionalPair()
  const before = structuredClone(sheet)
  sheet.baseline.provenanceNote = 'PRIVATE_PROVENANCE_SENTINEL fictional@example.test'
  sheet.candidate.lines[0].observedProduct.note = 'PRIVATE_PRODUCT_NOTE_SENTINEL'
  sheet.candidate.lines[0].observedProduct.sourceUrl = 'https://example.test/PRIVATE_PRODUCT_URL_SENTINEL'
  sheet.study.participantKey = 'private_pseudonym_not_for_report'
  assert.equal(observationSheetReadiness(sheet).ready, true)
  const safeBefore = structuredClone(sheet)
  const report = buildObservedWeekReport(buildWeeklyBasketStudyFromObservationSheet(sheet))
  const json = JSON.stringify(report)
  assert.equal(report.outcome, 'better')
  assert.equal(report.claimable, true, 'only a synthetic private structural comparison')
  assert.equal(report.publicSavingsClaimEligible, false)
  for (const forbidden of [
    'PRIVATE_PROVENANCE_SENTINEL', 'PRIVATE_PRODUCT_NOTE_SENTINEL',
    'PRIVATE_PRODUCT_URL_SENTINEL', 'private_pseudonym_not_for_report',
    'fictional@example.test',
  ]) {
    assert.ok(!json.includes(forbidden), 'private report exposed ' + forbidden)
  }
  assert.ok(!Object.hasOwn(report, 'participantKey'))
  assert.deepEqual(sheet, safeBefore, 'reporting must not mutate the original private observation')
  assert.deepEqual(before.baseline.lines, sheet.baseline.lines, 'input product rows must not change')
})

test('M3 private report: direct emails in every echoed metadata surface are refused before publication', async t => {
  const cases = [
    ['population', s => { s.study.population = 'student group qa.person@example.test' }],
    ['region', s => { s.study.region = 'fictional region qa.person@example.test' }],
    ['baseline store id', s => { s.baseline.store.id = 'qa.person@example.test' }],
    ['candidate store id', s => { s.candidate.store.id = 'qa.person@example.test' }],
    ['baseline store name', s => { s.baseline.store.name = 'PLUS qa.person@example.test' }],
    ['candidate store name', s => { s.candidate.store.name = 'DekaMarkt qa.person@example.test' }],
  ]
  for (const [label, mutate] of cases) {
    await t.test(label, () => {
      const sheet = fictionalPair()
      mutate(sheet)
      // This is an explicit report privacy gate, not a claim that the
      // paper-readiness UX must independently reject each metadata surface.
      assert.throws(
        () => buildObservedWeekReport(buildWeeklyBasketStudyFromObservationSheet(sheet)),
        /direct email identifier; private report refused/,
      )
    })
  }
})

test('M3 private report: visible fictional store metadata stays usable without leaking participant fields', () => {
  const sheet = fictionalPair()
  sheet.baseline.store.name = 'PLUS locatie-synthetisch'
  sheet.candidate.store.name = 'DekaMarkt locatie-synthetisch'
  const report = buildObservedWeekReport(buildWeeklyBasketStudyFromObservationSheet(sheet))
  assert.equal(report.baseline.storeName, 'PLUS locatie-synthetisch')
  assert.equal(report.candidate.storeName, 'DekaMarkt locatie-synthetisch')
  assert.equal(report.baseline.storeId, 'fictional_store_baseline')
  assert.equal(report.candidate.storeId, 'fictional_store_candidate')
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.doesNotMatch(JSON.stringify(report), /fictional_student_key/)
})
