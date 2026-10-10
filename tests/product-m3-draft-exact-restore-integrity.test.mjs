import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'

// Synthetic draft data only. No observed supermarket prices or user identity.
test('M3 draft restore refuses mutated immutable demand and collection-window metadata', async (t) => {
  const cases = [
    ['PLUS line extra demand field', s => { s.baseline.lines[0].requirement.sourcePrice = 199 }],
    ['DekaMarkt line extra demand field', s => { s.candidate.lines[0].requirement.sourceQuantity = 2 }],
    ['PLUS line requirement key reordered', s => {
      const { amount, unit } = s.baseline.lines[0].requirement
      s.baseline.lines[0].requirement = { unit, amount }
    }],
    ['DekaMarkt line requirement key reordered', s => {
      const { amount, unit } = s.candidate.lines[0].requirement
      s.candidate.lines[0].requirement = { unit, amount }
    }],
    ['falsified 48-hour observation window', s => { s.study.maxObservationWindowHours = 48 }],
    ['absent observation window contract', s => { delete s.study.maxObservationWindowHours }],
  ]
  for (const [label, mutate] of cases) {
    await t.test(label, () => {
      const sheet = buildObservationSheet()
      mutate(sheet)
      const before = structuredClone(sheet)
      const restored = restoreObservationSheetDraft(JSON.stringify(sheet))
      assert.equal(restored, null, label + ': do not silently normalize tampered measurements')
      assert.deepEqual(sheet, before)
    })
  }
})

test('canonical M3 draft remains safely restorable with user fields unchanged', () => {
  const sheet = buildObservationSheet()
  sheet.study.studyId = 'synthetic-week-001'
  sheet.study.participantKey = 'synthetic-pseudo'
  sheet.baseline.source = 'receipt'
  sheet.candidate.source = 'consented-export'
  sheet.baseline.lines[0].observedProduct.available = false
  const restored = restoreObservationSheetDraft(JSON.stringify(sheet))
  assert.ok(restored)
  assert.deepEqual(restored, sheet)
  assert.equal(restored.evidenceStatus, 'collection-template-not-evidence')
})
