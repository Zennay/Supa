import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet, restoreObservationSheetDraft,
  observationSheetReadiness, observationWindowSummary, observationSheetProgress,
} from '../src/domain/m3ObservationSheet.ts'

// Independent postrepair acceptance after #1845. Only synthetic M2-generated
// requirement labels/prices; never an actual observation or saving claim.
function recordedSheet(first, second) {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-private-collector-accept',
    participantKey: 'anonymous-test-only',
    population: 'Synthetic students',
    region: 'Fictitious QA area',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })
  for (const [side, storeName, observedAt] of [
    ['baseline', 'PLUS synthetic QA shop', first],
    ['candidate', 'DekaMarkt synthetic QA shop', second],
  ]) {
    const part = sheet[side]
    part.evidenceId = side + '-review-only'
    part.observedAt = observedAt
    part.provenanceNote = 'Fictional test fixtures only'
    part.store = { id: side + '-test', name: storeName }
    part.lines.forEach((line, index) => {
      const requirement = sheet.requirements[index]
      line.observedProduct = {
        available: true, productId: side + '-product-' + index,
        productName: requirement.query, packAmount: requirement.amount,
        packUnit: requirement.unit, packCount: 1,
        priceCents: 90 + index, sourceUrl: '', note: 'QA-only',
      }
    })
  }
  return sheet
}

test('independent #1513: JSON-restored candidate submillisecond clocks can never become ready', () => {
  const base = '2026-10-08T10:00:00.123000000Z'
  for (let position = 4; position <= 9; position++) {
    const fraction = '123' + '0'.repeat(position - 4) + '9' + '0'.repeat(9 - position)
    const original = recordedSheet(base, '2026-10-09T10:00:00.' + fraction + 'Z')
    const bytes = JSON.stringify(original)
    const restored = restoreObservationSheetDraft(bytes)
    assert.ok(restored)
    assert.equal(observationSheetProgress(restored).completeLines, 22)
    const readiness = observationSheetReadiness(restored)
    assert.equal(readiness.ready, false, String(position))
    assert.ok(readiness.issues.some(x => x.includes('Winkel B') && x.includes('observatietijd')))
    assert.notEqual(observationWindowSummary(restored).state, 'within-window')
    assert.equal(JSON.stringify(original), bytes)
  }
})

test('independent #1513: baseline-only invisible precision is not a deadline', () => {
  const sheet = recordedSheet('2026-10-08T10:00:00.000000001+02:00', '')
  assert.equal(observationWindowSummary(sheet).state, 'not-started')
  assert.equal(observationSheetReadiness(sheet).ready, false)
})

test('independent #1513: nine fractional zero digits and DST offset stay exact and ready', () => {
  const sheet = recordedSheet(
    '2026-10-24T18:00:00.123000000+02:00',
    '2026-10-25T17:00:00.123000000+01:00',
  )
  const original = JSON.stringify(sheet)
  const restored = restoreObservationSheetDraft(original)
  assert.ok(restored)
  assert.deepEqual(observationSheetReadiness(restored), { ready: true, issues: [] })
  assert.deepEqual(observationWindowSummary(restored), { state: 'within-window', deltaHours: 24 })
  assert.equal(JSON.stringify(sheet), original)
})
