import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  nextIncompleteObservationLine,
  observationSheetHasUserInput,
  observationSheetProgress,
  observationSheetReadiness,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'

const SIDES = ['baseline', 'candidate']

function unavailableButMeasuredSheet() {
  const sheet = buildObservationSheet()
  for (const side of SIDES) {
    for (const line of sheet[side].lines) {
      line.observedProduct.available = false
    }
  }
  return sheet
}

test('M3 every possible last unmeasured store item remains the exact next target after JSON recovery', () => {
  let probes = 0

  for (const side of SIDES) {
    for (let index = 0; index < 11; index++) {
      const sheet = unavailableButMeasuredSheet()
      sheet[side].lines[index].observedProduct.available = null

      const restored = restoreObservationSheetDraft(JSON.stringify(sheet))
      assert.ok(restored, 'synthetic draft must restore without claiming field evidence')
      const progress = observationSheetProgress(restored)
      assert.deepEqual(
        {
          totalLines: progress.totalLines,
          availabilityRecorded: progress.availabilityRecorded,
          completeLines: progress.completeLines,
        },
        { totalLines: 22, availabilityRecorded: 21, completeLines: 21 },
        `Missing ${side}/${index} cannot count as completed`,
      )
      assert.deepEqual(
        nextIncompleteObservationLine(restored),
        {
          side,
          ingredientId: restored[side].lines[index].ingredientId,
        },
        `Missing ${side}/${index} must be the next collection action`,
      )
      assert.equal(observationSheetHasUserInput(restored), true)
      assert.equal(observationSheetReadiness(restored).ready, false)
      assert.equal(restored.evidenceStatus, 'collection-template-not-evidence')
      probes++
    }
  }

  assert.equal(probes, 22)
})

test('M3 22 measured-unavailable synthetic items complete navigation, not observed-study metadata', () => {
  const sheet = unavailableButMeasuredSheet()
  const restored = restoreObservationSheetDraft(JSON.stringify(sheet))
  assert.ok(restored)

  const progress = observationSheetProgress(restored)
  assert.deepEqual(
    {
      totalLines: progress.totalLines,
      availabilityRecorded: progress.availabilityRecorded,
      completeLines: progress.completeLines,
    },
    { totalLines: 22, availabilityRecorded: 22, completeLines: 22 },
  )
  assert.equal(nextIncompleteObservationLine(restored), null)
  assert.equal(observationSheetHasUserInput(restored), true)
  assert.equal(observationSheetReadiness(restored).ready, false)
  assert.equal(restored.evidenceStatus, 'collection-template-not-evidence')
})
