import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildObservationSheet,
  observationSheetReadiness,
  observationWindowSummary,
} from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'

// Independent follow-up after RED -> GREEN #1199/#1200, not real field evidence.
// Exactly 22 imaginary demands, all explicitly unavailable, no price or PII.
function sheetFixture() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-identifier',
    participantKey: 'qa-participant',
    population: 'synthetic-only',
    region: 'synthetic-only',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
  })
  for (const side of ['baseline', 'candidate']) {
    Object.assign(sheet[side], {
      evidenceId: side + '-synthetic',
      observedAt: side === 'baseline'
        ? '2026-10-04T12:00:00Z'
        : '2026-10-05T12:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic unavailable-only validation fixture.',
      store: side === 'baseline'
        ? { id: 'plus-synthetic', name: 'PLUS synthetic' }
        : { id: 'deka-synthetic', name: 'DekaMarkt synthetic' },
    })
    sheet[side].lines.forEach(line => { line.observedProduct.available = false })
  }
  assert.equal(sheet.baseline.lines.length + sheet.candidate.lines.length, 22)
  return sheet
}

function ready(sheet) {
  const before = JSON.stringify(sheet)
  const result = observationSheetReadiness(sheet)
  assert.equal(JSON.stringify(sheet), before, 'readiness must not mutate the collected sheet')
  return result
}

test('inclusive 24h and valid 3-character pseudonymous keys remain structurally ready, without savings', () => {
  const sheet = sheetFixture()
  sheet.study.studyId = 'abc'
  sheet.study.participantKey = 'a-1'
  assert.deepEqual(ready(sheet), { ready: true, issues: [] })
  assert.equal(observationWindowSummary(sheet).state, 'within-window')
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  assert.equal(study.baseline.basket.matchedLineCount, 0)
  assert.equal(study.candidate.basket.matchedLineCount, 0)
})

test('maximum 64-character path-safe keys remain accepted at both collector and converter', () => {
  const sheet = sheetFixture()
  sheet.study.studyId = 'a' + 'b'.repeat(63)
  sheet.study.participantKey = 'z' + '_'.repeat(63)
  assert.deepEqual(ready(sheet), { ready: true, issues: [] })
  assert.ok(buildWeeklyBasketStudyFromObservationSheet(sheet))
})

test('historical leap day remains accepted as a calendar-valid weekStart', () => {
  const sheet = sheetFixture()
  sheet.study.weekStart = '2024-02-29'
  assert.deepEqual(ready(sheet), { ready: true, issues: [] })
  assert.ok(buildWeeklyBasketStudyFromObservationSheet(sheet))
})

test('non-leap February 29 cannot appear export-ready', () => {
  const sheet = sheetFixture()
  sheet.study.weekStart = '2025-02-29'
  assert.throws(() => buildWeeklyBasketStudyFromObservationSheet(sheet), /weekStart/)
  const result = ready(sheet)
  assert.equal(result.ready, false)
  assert.ok(result.issues.some(s => /Week start/.test(s)))
  assert.doesNotMatch(result.issues.join(' '), /2025-02-29/)
})

for (const [name, field, value] of [
  ['two-character study key', 'studyId', 'ab'],
  ['65-character study key', 'studyId', 'a' + 'b'.repeat(64)],
  ['two-character participant key', 'participantKey', 'a1'],
  ['65-character participant key', 'participantKey', 'z' + '-'.repeat(64)],
]) {
  test(`${name} rejected by collector with no identifier disclosure`, () => {
    const sheet = sheetFixture()
    sheet.study[field] = value
    assert.throws(() => buildWeeklyBasketStudyFromObservationSheet(sheet), /path-safe/)
    const result = ready(sheet)
    assert.equal(result.ready, false)
    assert.ok(result.issues.length > 0)
    assert.equal(result.issues.join(' ').includes(value), false)
  })
}

for (const field of ['studyId', 'participantKey', 'weekStart', 'priceContext']) {
  test(`blank ${field} keeps the existing single missing-field message`, () => {
    const sheet = sheetFixture()
    sheet.study[field] = ''
    const result = ready(sheet)
    assert.equal(result.ready, false)
    assert.equal(result.issues.length, 1)
    assert.match(result.issues[0], /ontbreekt/)
  })
}
