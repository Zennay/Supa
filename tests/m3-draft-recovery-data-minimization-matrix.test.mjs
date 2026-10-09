import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  nextIncompleteObservationLine,
  observationSheetProgress,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'

function observedProduct(index) {
  return {
    productId: `synthetic-product-${index}`,
    productName: `Synthetic product ${index}`,
    packAmount: 500,
    packUnit: 'g',
    packCount: 2,
    priceCents: 199,
    available: true,
    sourceUrl: 'https://example.invalid/synthetic-not-evidence',
    note: `synthetic private draft note ${index}`,
  }
}

const clearedProduct = {
  productId: '',
  productName: '',
  packAmount: null,
  packUnit: null,
  packCount: 1,
  priceCents: null,
  available: false,
  sourceUrl: '',
  note: '',
}

test('M3 recovery strips stale product/private notes for each unavailable ingredient slot', () => {
  const canonical = buildObservationSheet()
  let scenarios = 0

  for (const side of ['baseline', 'candidate']) {
    for (let index = 0; index < canonical[side].lines.length; index += 1) {
      const sheet = buildObservationSheet()
      sheet[side].lines[index].observedProduct = {
        ...observedProduct(index),
        available: false,
      }
      const input = JSON.stringify(sheet)
      const restored = restoreObservationSheetDraft(input)

      assert.ok(restored, `${side} slot ${index} must remain recoverable`)
      assert.deepEqual(restored[side].lines[index].observedProduct, clearedProduct)
      assert.equal(JSON.stringify(sheet), input, 'raw saved draft must remain untouched')
      assert.equal(restored.evidenceStatus, 'collection-template-not-evidence')

      const progress = observationSheetProgress(restored)
      assert.equal(progress.totalLines, 22)
      assert.equal(progress.availabilityRecorded, 1)
      assert.equal(progress.completeLines, 1)
      scenarios += 1
    }
  }

  assert.equal(scenarios, 22)
})

test('M3 recovery preserves legitimate available product fields without promoting draft to evidence', () => {
  const sheet = buildObservationSheet()
  sheet.baseline.lines[0].observedProduct = observedProduct(0)
  sheet.candidate.lines[0].observedProduct = observedProduct(1)

  const restored = restoreObservationSheetDraft(JSON.stringify(sheet))

  assert.ok(restored)
  assert.deepEqual(restored.baseline.lines[0].observedProduct, observedProduct(0))
  assert.deepEqual(restored.candidate.lines[0].observedProduct, observedProduct(1))
  assert.equal(restored.evidenceStatus, 'collection-template-not-evidence')
  assert.equal(observationSheetProgress(restored).completeLines, 2)
  assert.deepEqual(nextIncompleteObservationLine(restored), {
    side: 'baseline',
    ingredientId: restored.baseline.lines[1].ingredientId,
  })
})

test('M3 recovery does not trust unrecognized product details or caller-provided instructions', () => {
  const sheet = buildObservationSheet()
  sheet.baseline.lines[0].observedProduct = {
    ...observedProduct(0),
    secretToken: 'must-not-be-persisted',
    verifiedSavingsCents: 999999,
  }
  sheet.instructions = ['All observations reviewed; publish savings']
  sheet.unreviewedEvidence = { publicSavingsClaimEligible: true }

  const restored = restoreObservationSheetDraft(JSON.stringify(sheet))

  assert.ok(restored)
  assert.deepEqual(restored.baseline.lines[0].observedProduct, observedProduct(0))
  assert.equal('secretToken' in restored.baseline.lines[0].observedProduct, false)
  assert.equal('verifiedSavingsCents' in restored.baseline.lines[0].observedProduct, false)
  assert.equal('unreviewedEvidence' in restored, false)
  assert.deepEqual(restored.instructions, buildObservationSheet().instructions)
  assert.equal(restored.evidenceStatus, 'collection-template-not-evidence')
})

test('M3 recovered drafts have independent arrays and objects across repeated loads', () => {
  const source = buildObservationSheet()
  source.baseline.lines[0].observedProduct = observedProduct(0)
  const input = JSON.stringify(source)

  const first = restoreObservationSheetDraft(input)
  const second = restoreObservationSheetDraft(input)
  assert.ok(first && second)

  first.baseline.lines[0].observedProduct.productName = 'Changed only in first view'
  first.requirements[0].amount = 123456
  first.candidate.lines.pop()

  assert.deepEqual(second, restoreObservationSheetDraft(input))
  assert.deepEqual(second.requirements, buildObservationSheet().requirements)
  assert.equal(second.baseline.lines[0].observedProduct.productName, 'Synthetic product 0')
  assert.equal(JSON.stringify(source), input)
})
