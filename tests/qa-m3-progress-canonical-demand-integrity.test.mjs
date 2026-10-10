import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationSheetProgress,
  observationSheetReadiness,
} from '../src/domain/m3ObservationSheet.ts'

// Synthetic availability only. This test must never be used as evidence of
// genuine PLUS or DekaMarkt product availability, prices or savings.
function completeSyntheticAvailability() {
  const sheet = buildObservationSheet()
  for (const side of ['baseline', 'candidate']) {
    sheet[side].lines.forEach(line => { line.observedProduct.available = false })
  }
  return sheet
}

test('M3 progress counts only observations with immutable canonical demand identity', async (t) => {
  const healthy = completeSyntheticAvailability()
  const control = observationSheetProgress(healthy)
  assert.equal(control.totalLines, 22)
  assert.equal(control.completeLines, 22)
  assert.equal(control.availabilityRecorded, 22)

  const mutations = [
    ['baseline ingredient id spoof', s => { s.baseline.lines[0].ingredientId = 'forged-other-ingredient' }],
    ['candidate ingredient label spoof', s => { s.candidate.lines[0].ingredientLabel = 'Andere hoeveelheid' }],
    ['baseline demand amount changed', s => { s.baseline.lines[0].requirement.amount += 1 }],
    ['candidate demand unit changed', s => { s.candidate.lines[0].requirement.unit = 'l' }],
    ['baseline demand extra property', s => { s.baseline.lines[0].requirement.offer = 'fake' }],
    ['candidate requirement order reversed', s => {
      const { amount, unit } = s.candidate.lines[0].requirement
      s.candidate.lines[0].requirement = { unit, amount }
    }],
    ['duplicate baseline line identity', s => { s.baseline.lines[1] = structuredClone(s.baseline.lines[0]) }],
    ['missing candidate line', s => { s.candidate.lines.pop() }],
  ]

  for (const [name, corrupt] of mutations) {
    await t.test(name, () => {
      const sheet = completeSyntheticAvailability()
      corrupt(sheet)
      const snapshot = structuredClone(sheet)
      assert.equal(observationSheetReadiness(sheet).ready, false)
      const progress = observationSheetProgress(sheet)
      assert.equal(progress.totalLines, 22)
      assert.ok(progress.completeLines < 22,
        'corrupt demand or line identity is not completely collected')
      assert.ok(progress.availabilityRecorded < 22,
        'corrupt demand or line identity cannot certify observed availability')
      assert.deepEqual(sheet, snapshot, 'collectors must never normalize corrupted inputs')
    })
  }
})
