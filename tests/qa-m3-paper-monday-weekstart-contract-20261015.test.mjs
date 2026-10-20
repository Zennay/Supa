import assert from 'node:assert/strict'
import test from 'node:test'
import { buildObservationSheet, observationSheetReadiness } from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

// Independent paper "Week vanaf (maandag)" semantic contract. Every price and
// identity is fabricated, not field evidence or an authorized retailer sample.
function fullyMatchedFictionalWeek(weekStart) {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa_monday_week_contract',
    participantKey: 'synthetic_no_person',
    population: 'test-only cohort', region: 'fictional region',
    weekStart, priceContext: 'in-store',
  })
  for (const [side, name, hour, priceCents] of [
    ['baseline', 'PLUS', '10', 250],
    ['candidate', 'DekaMarkt', '11', 200],
  ]) {
    const record = sheet[side]
    record.store = { id: 'fictional_' + side, name }
    record.evidenceId = 'fictional_evidence_' + side
    record.observedAt = '2026-10-14T' + hour + ':00:00Z'
    record.source = 'manual-cart'
    record.provenanceNote = 'synthetic, no retailer access'
    record.lines.forEach((line, index) => {
      const req = sheet.requirements[index]
      line.observedProduct = {
        productId: side + '_' + req.id,
        productName: req.query,
        packAmount: req.amount, packUnit: req.unit,
        packCount: 1, priceCents, available: true,
        sourceUrl: '', note: '',
      }
    })
  }
  return sheet
}

test('M3 Monday paper contract positive: true Monday week and Wednesday stores are structurally comparable only', () => {
  const sheet = fullyMatchedFictionalWeek('2026-10-12')
  assert.equal(new Date(sheet.study.weekStart + 'T00:00:00Z').getUTCDay(), 1)
  assert.deepEqual(observationSheetReadiness(sheet), { ready: true, issues: [] })
  const report = buildObservedWeekReport(buildWeeklyBasketStudyFromObservationSheet(sheet))
  assert.equal(report.claimable, true)
  assert.equal(report.outcome, 'better')
  assert.equal(report.publicSavingsClaimEligible, false)
})

test('M3 paper mandates a Monday: Tuesday and Sunday weekStart must not become a complete field draft', async t => {
  for (const [day, date] of [['Tuesday', '2026-10-13'], ['Sunday', '2026-10-11']]) {
    await t.test(day, () => {
      const sheet = fullyMatchedFictionalWeek(date)
      assert.notEqual(new Date(date + 'T00:00:00Z').getUTCDay(), 1)
      const verdict = observationSheetReadiness(sheet)
      assert.equal(verdict.ready, false, 'printed worksheet says Monday; invalid start ' + date + ' was marked ready')
      assert.match(verdict.issues.join(' '), /week start|maandag|monday/i)
    })
  }
})

test('M3 report must not claim an otherwise complete cheaper basket for a non-Monday stated week', () => {
  const sheet = fullyMatchedFictionalWeek('2026-10-13')
  const result = buildObservedWeekReport(buildWeeklyBasketStudyFromObservationSheet(sheet))
  assert.equal(result.claimable, false, 'non-Monday study must not enter M3 technical savings evidence')
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.equal(result.publicSavingsClaimEligible, false)
})
