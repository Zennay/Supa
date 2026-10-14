import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import {
  observationSheetReadiness,
} from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

const now = Date.parse('2026-10-14T12:00:00Z')
const sources = ['manual-cart', 'receipt', 'consented-export']

test('M3 accepts all approved 3x3x2 source and price-context combinations on fictional complete 11+11 sheets', () => {
  for (const a of sources) for (const b of sources) for (const context of ['in-store', 'online-order']) {
    const sheet = buildFictionalPricedSheet(90)
    sheet.study.priceContext = context
    sheet.baseline.source = a
    sheet.candidate.source = b
    const bytes = JSON.stringify(sheet)
    const ready = observationSheetReadiness(sheet, now)
    assert.equal(ready.ready, true, a + '/' + b + '/' + context + ': ' + ready.issues)
    const privateReport = buildObservedWeekReport(buildWeeklyBasketStudyFromObservationSheet(sheet))
    assert.equal(privateReport.claimable, true)
    assert.equal(privateReport.publicSavingsClaimEligible, false)
    assert.equal(Object.hasOwn(privateReport, 'participantKey'), false)
    assert.equal(JSON.stringify(sheet), bytes)
  }
})

test('M3 collector rejects unapproved purported sources instead of allowing a doomed JSON conversion', () => {
  for (const side of ['baseline', 'candidate']) {
    for (const invalid of ['browser-cache', 'search-snippet', 'unknown', '', null]) {
      const sheet = buildFictionalPricedSheet()
      sheet[side].source = invalid
      const before = JSON.stringify(sheet)
      const ready = observationSheetReadiness(sheet, now)
      assert.equal(ready.ready, false, side + '/' + invalid)
      assert.ok(ready.issues.some(issue => issue.includes('geldige herkomst')),
        'operator receives actionable Dutch collection guidance')
      assert.throws(() => buildWeeklyBasketStudyFromObservationSheet(sheet),
        /source|bron|herkomst/i)
      assert.equal(JSON.stringify(sheet), before)
    }
  }
})

test('M3 collector refuses duplicate PLUS and DekaMarkt evidence IDs before export', () => {
  const sheet = buildFictionalPricedSheet()
  sheet.candidate.evidenceId = sheet.baseline.evidenceId
  const before = JSON.stringify(sheet)
  const ready = observationSheetReadiness(sheet, now)
  assert.equal(ready.ready, false)
  assert.ok(ready.issues.some(issue => issue.includes('verschillende evidence-ID')),
    'operator must understand that two separate store captures need distinct IDs')
  const report = buildObservedWeekReport(buildWeeklyBasketStudyFromObservationSheet(sheet))
  assert.equal(report.claimable, false)
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.deltaCents, null)
  assert.equal(report.savingsCents, null)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(JSON.stringify(sheet), before)
})
