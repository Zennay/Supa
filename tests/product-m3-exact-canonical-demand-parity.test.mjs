import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationSheetReadiness,
} from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'

// Synthetic 11-requirement fixture. No real retailer prices or participant data.
function completedSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-canonical-001',
    participantKey: 'test-student-pseudo',
    population: 'synthetic',
    region: 'synthetic',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })
  for (const side of ['baseline', 'candidate']) {
    const store = sheet[side]
    store.evidenceId = side + '-synthetic-proof'
    store.observedAt = side === 'baseline'
      ? '2026-10-05T09:00:00Z'
      : '2026-10-05T10:00:00Z'
    store.provenanceNote = 'Synthetic local test only'
    store.store = {
      id: side + '-synthetic-store',
      name: side === 'baseline' ? 'PLUS' : 'DekaMarkt',
    }
    store.lines.forEach((line) => { line.observedProduct.available = false })
  }
  assert.deepEqual(observationSheetReadiness(sheet), { ready: true, issues: [] })
  return sheet
}

test('M3 readiness agrees with canonical converter for exact requirement payloads', async (t) => {
  const cases = [
    ['extra top-level ingredient field', s => { s.requirements[0].externalPrice = 199 }],
    ['extra top-level identity field', s => { s.requirements[0].alternateUnit = 'kg' }],
    ['reordered top-level ingredient keys', s => {
      const { id, label, query, amount, unit } = s.requirements[0]
      s.requirements[0] = { unit, amount, query, label, id }
    }],
    ['extra PLUS line demand field', s => { s.baseline.lines[0].requirement.external = 'stale' }],
    ['extra DekaMarkt line demand field', s => { s.candidate.lines[0].requirement.packCount = 2 }],
    ['reordered PLUS demand keys', s => {
      const { amount, unit } = s.baseline.lines[0].requirement
      s.baseline.lines[0].requirement = { unit, amount }
    }],
    ['reordered DekaMarkt demand keys', s => {
      const { amount, unit } = s.candidate.lines[0].requirement
      s.candidate.lines[0].requirement = { unit, amount }
    }],
  ]
  for (const [label, mutate] of cases) {
    await t.test(label, () => {
      const sheet = completedSheet()
      mutate(sheet)
      const snapshot = structuredClone(sheet)
      assert.throws(() => buildWeeklyBasketStudyFromObservationSheet(sheet))
      const ready = observationSheetReadiness(sheet)
      assert.equal(ready.ready, false, label + ': must not suggest export')
      assert.match(ready.issues.join(' '), /ingredient|weekplanning/i)
      assert.deepEqual(sheet, snapshot)
    })
  }
})

test('valid canonical requirement payloads remain export-ready', () => {
  const sheet = completedSheet()
  const result = buildWeeklyBasketStudyFromObservationSheet(sheet)
  assert.equal(result.baseline.basket.lines.length, 11)
  assert.equal(result.candidate.basket.lines.length, 11)
  assert.equal(result.baseline.basket.unresolvedLineCount, 11)
  assert.deepEqual(observationSheetReadiness(sheet), { ready: true, issues: [] })
})
