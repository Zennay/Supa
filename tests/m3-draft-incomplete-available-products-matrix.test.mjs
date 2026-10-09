import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  nextIncompleteObservationLine,
  observationSheetProgress,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'

// Synthetic collection-completeness cases: no prices or observations from actual stores.
function fullyEnteredDraft() {
  const sheet = buildObservationSheet()
  let index = 0

  for (const side of ['baseline', 'candidate']) {
    for (const line of sheet[side].lines) {
      line.observedProduct = {
        productId: `synthetic-${side}-${index}`,
        productName: `Synthetic ${line.ingredientLabel}`,
        packAmount: 1000,
        packUnit: line.requirement.unit,
        packCount: 1,
        priceCents: 100 + index,
        available: true,
        sourceUrl: 'https://example.invalid/synthetic',
        note: 'qa-only',
      }
      index += 1
    }
  }

  assert.deepEqual(observationSheetProgress(sheet), {
    totalLines: 22,
    availabilityRecorded: 22,
    completeLines: 22,
    metadataCompleted: 0,
    metadataTotal: 16,
  })
  return sheet
}

test('M3 draft recovery never marks any of 88 malformed available-product fields complete', () => {
  const badFields = [
    ['blank product name', (product) => { product.productName = '   ' }],
    ['invalid pack amount', (product) => { product.packAmount = -5 }],
    ['unsupported pack unit', (product) => { product.packUnit = 'not-a-unit' }],
    ['non-monetary price', (product) => { product.priceCents = '199' }],
  ]

  let checked = 0
  for (const side of ['baseline', 'candidate']) {
    for (let index = 0; index < 11; index += 1) {
      for (const [name, corrupt] of badFields) {
        const sheet = fullyEnteredDraft()
        corrupt(sheet[side].lines[index].observedProduct)

        const restored = restoreObservationSheetDraft(JSON.stringify(sheet))
        assert.ok(restored, `${side} index ${index} ${name}`)
        const progress = observationSheetProgress(restored)

        assert.equal(progress.totalLines, 22)
        assert.equal(progress.availabilityRecorded, 22)
        assert.equal(
          progress.completeLines,
          21,
          `${side} index ${index}: ${name} must require correction`,
        )
        assert.deepEqual(
          nextIncompleteObservationLine(restored),
          { side, ingredientId: sheet[side].lines[index].ingredientId },
        )
        assert.equal(restored.evidenceStatus, 'collection-template-not-evidence')
        checked += 1
      }
    }
  }
  assert.equal(checked, 88)
})

test('M3 draft recovery keeps unknown availability incomplete for all 22 ingredient slots', () => {
  let checked = 0
  for (const side of ['baseline', 'candidate']) {
    for (let index = 0; index < 11; index += 1) {
      const sheet = fullyEnteredDraft()
      sheet[side].lines[index].observedProduct.available = 'yes'
      const restored = restoreObservationSheetDraft(JSON.stringify(sheet))
      assert.ok(restored)

      const progress = observationSheetProgress(restored)
      assert.equal(progress.availabilityRecorded, 21)
      assert.equal(progress.completeLines, 21)
      assert.equal(restored[side].lines[index].observedProduct.available, null)
      assert.deepEqual(
        nextIncompleteObservationLine(restored),
        { side, ingredientId: sheet[side].lines[index].ingredientId },
      )
      checked += 1
    }
  }
  assert.equal(checked, 22)
})
