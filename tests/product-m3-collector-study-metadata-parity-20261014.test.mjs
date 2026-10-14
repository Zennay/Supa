import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { observationSheetReadiness } from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

const reviewNow = Date.parse('2026-10-14T12:00:00Z')

// These are only fictional full 11 PLUS + 11 DekaMarkt records.
test('collector refuses noncanonical study IDs, participant keys, week dates and price contexts', () => {
  const cases = [
    ['studyId', 'two words', 'Study ID moet een veilige'],
    ['studyId', 'ab', 'Study ID moet een veilige'],
    ['studyId', 'a'.repeat(65), 'Study ID moet een veilige'],
    ['participantKey', 'Not-Path-Safe', 'Participant key moet een veilige'],
    ['participantKey', 'contact@example.com', 'Participant key moet een veilige'],
    ['weekStart', '2026-2-30', 'Week start moet een geldige'],
    ['weekStart', '2026-02-30', 'Week start moet een geldige'],
    ['weekStart', '2026-13-01', 'Week start moet een geldige'],
    ['priceContext', 'store-and-online', 'Prijscontext moet in-store of online-order'],
  ]
  for (const [field, invalid, issueText] of cases) {
    const sheet = buildFictionalPricedSheet()
    sheet.study[field] = invalid
    const before = JSON.stringify(sheet)
    const readiness = observationSheetReadiness(sheet, reviewNow)
    assert.equal(readiness.ready, false, field + '/' + invalid)
    assert.ok(readiness.issues.some(issue => issue.includes(issueText)),
      'operator must receive actionable field-specific Dutch guidance')
    assert.throws(() => buildWeeklyBasketStudyFromObservationSheet(sheet),
      /studyId|participantKey|weekStart|priceContext|valid YYYY-MM-DD|path-safe|unsupported/i,
      'real converter cannot accept an invalid collection metadata field')
    assert.equal(JSON.stringify(sheet), before)
  }
})

test('valid M3 metadata remains ready, including leap year and both price contexts', () => {
  for (const context of ['in-store', 'online-order']) {
    const sheet = buildFictionalPricedSheet()
    sheet.study.priceContext = context
    sheet.study.weekStart = '2024-02-26'
    sheet.baseline.observedAt = '2024-02-29T10:00:00Z'
    sheet.candidate.observedAt = '2024-02-29T10:15:00Z'
    const original = JSON.stringify(sheet)
    const ready = observationSheetReadiness(sheet, reviewNow)
    assert.equal(ready.ready, true, context + ': ' + ready.issues)
    const report = buildObservedWeekReport(buildWeeklyBasketStudyFromObservationSheet(sheet))
    assert.equal(report.claimable, true)
    assert.equal(report.outcome, 'better')
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(Object.hasOwn(report, 'participantKey'), false)
    assert.equal(JSON.stringify(sheet), original)
  }
})
