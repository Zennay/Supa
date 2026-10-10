import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationSheetReadiness,
  observationWindowSummary,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'

// All examples are synthetic. None represents observed retailer or savings data.
function completedSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-review-001',
    participantKey: 'student-synthetic',
    population: 'synthetic',
    region: 'test-region',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })
  for (const side of ['baseline', 'candidate']) {
    const observation = sheet[side]
    observation.store.id = side + '-store'
    observation.store.name = side === 'baseline' ? 'PLUS store' : 'DekaMarkt store'
    observation.evidenceId = side + '-evidence'
    observation.observedAt = side === 'baseline'
      ? '2026-10-05T09:00:00Z'
      : '2026-10-05T09:30:00Z'
    observation.provenanceNote = 'Synthetic validation fixture'
    observation.lines.forEach((line) => { line.observedProduct.available = false })
  }
  assert.deepEqual(observationSheetReadiness(sheet), { ready: true, issues: [] })
  return sheet
}

test('M3 24-hour limit is immutable for readiness and window guidance', () => {
  const sheet = completedSheet()
  sheet.study.maxObservationWindowHours = 48
  sheet.candidate.observedAt = '2026-10-06T10:00:01Z'
  const previous = structuredClone(sheet)
  const readiness = observationSheetReadiness(sheet)
  assert.equal(readiness.ready, false)
  assert.match(readiness.issues.join(' '), /24 uur/)
  const summary = observationWindowSummary(sheet)
  assert.equal(summary.state, 'outside-window')
  assert.deepEqual(sheet, previous)
})

test('M3 single-observation deadline uses canonical 24 hours despite corrupted display limit', () => {
  const sheet = completedSheet()
  sheet.study.maxObservationWindowHours = 99
  sheet.candidate.observedAt = ''
  const previous = structuredClone(sheet)
  const result = observationWindowSummary(sheet)
  assert.equal(result.state, 'single-observation')
  assert.equal(result.deadlineAt, '2026-10-06T09:00:00.000Z')
  assert.deepEqual(sheet, previous)
})

test('M3 readiness treats each immutable sheet/line identity as a validation gate', async (t) => {
  const mutations = [
    ['schema', (s) => { s.schemaVersion = 2 }],
    ['sheet type', (s) => { s.sheetType = 'another-sheet' }],
    ['fixture', (s) => { s.plannerFixture = 'another-week' }],
    ['evidence status', (s) => { s.evidenceStatus = 'verified' }],
    ['meal count', (s) => { s.selectedMealCount-- }],
    ['reordered requirements', (s) => { s.requirements.reverse() }],
    ['changed requirement query', (s) => { s.requirements[0].query = 'made-up' }],
    ['changed baseline line label', (s) => { s.baseline.lines[0].ingredientLabel = 'wrong' }],
    ['changed candidate line unit', (s) => { s.candidate.lines[0].requirement.unit = 'l' }],
    ['removed candidate line', (s) => { s.candidate.lines.pop() }],
  ]
  for (const [description, mutate] of mutations) {
    await t.test(description, () => {
      const sheet = completedSheet()
      mutate(sheet)
      const before = structuredClone(sheet)
      const result = observationSheetReadiness(sheet)
      assert.equal(result.ready, false)
      assert.ok(result.issues.length > 0)
      assert.deepEqual(sheet, before)
    })
  }
})

test('M3 sources and evidence IDs cannot be silently reused or changed on restore', () => {
  const sheet = completedSheet()
  sheet.baseline.source = 'receipt'
  sheet.candidate.source = 'consented-export'
  const valid = restoreObservationSheetDraft(JSON.stringify(sheet))
  assert.ok(valid)
  assert.equal(valid.baseline.source, 'receipt')
  assert.equal(valid.candidate.source, 'consented-export')

  sheet.candidate.source = 'third-party-cache'
  const restored = restoreObservationSheetDraft(JSON.stringify(sheet))
  assert.equal(restored, null)
  assert.equal(observationSheetReadiness(sheet).ready, false)

  sheet.candidate.source = 'manual-cart'
  sheet.candidate.evidenceId = sheet.baseline.evidenceId
  assert.equal(observationSheetReadiness(sheet).ready, false)
})
