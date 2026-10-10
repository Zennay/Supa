import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  nextIncompleteObservationLine,
  observationLineCollectionComplete,
  observationSheetHasUserInput,
  observationSheetProgress,
  observationStoreProgress,
  restoreObservationSheetDraft,
  withObservedProductAvailability,
} from '../src/domain/m3ObservationSheet.ts'

// Only controlled M2 fixture demand: this is not a PLUS/DekaMarkt field observation.
const SIDES = ['baseline', 'candidate']

function canonicalPositions(sheet) {
  return SIDES.flatMap((side) =>
    sheet[side].lines.map((line, index) => ({
      side,
      index,
      ingredientId: line.ingredientId,
    })),
  )
}

function fillSyntheticProduct(line, index) {
  Object.assign(line.observedProduct, {
    available: true,
    productName: `synthetic product ${index}`,
    packAmount: 500,
    packUnit: 'g',
    packCount: 1,
    priceCents: 100 + index,
  })
}

function markEveryLineComplete(sheet) {
  for (const position of canonicalPositions(sheet)) {
    fillSyntheticProduct(sheet[position.side].lines[position.index], position.index)
  }
}

test('each canonical store/ingredient position has independent tri-state collection progress', () => {
  const template = buildObservationSheet()
  const positions = canonicalPositions(template)
  assert.ok(positions.length > 0)
  assert.equal(template.baseline.lines.length, template.candidate.lines.length)

  for (const position of positions) {
    for (const variant of ['unknown', 'available-incomplete', 'available-complete', 'unavailable']) {
      const sheet = buildObservationSheet()
      const line = sheet[position.side].lines[position.index]
      const originalOtherSide = JSON.stringify(
        sheet[position.side === 'baseline' ? 'candidate' : 'baseline'],
      )

      if (variant === 'available-incomplete') {
        line.observedProduct.available = true
      } else if (variant === 'available-complete') {
        fillSyntheticProduct(line, position.index)
      } else if (variant === 'unavailable') {
        line.observedProduct = withObservedProductAvailability(line.observedProduct, false)
      }

      const expectedRecorded = variant === 'unknown' ? 0 : 1
      const expectedCompleted =
        variant === 'available-complete' || variant === 'unavailable' ? 1 : 0
      const progress = observationSheetProgress(sheet)
      const sideProgress = observationStoreProgress(sheet[position.side])

      assert.equal(progress.totalLines, positions.length, `${position.side}/${position.index}/${variant}`)
      assert.equal(progress.availabilityRecorded, expectedRecorded)
      assert.equal(progress.completeLines, expectedCompleted)
      assert.equal(progress.metadataCompleted, 0)
      assert.equal(sideProgress.availabilityRecorded, expectedRecorded)
      assert.equal(sideProgress.completeLines, expectedCompleted)
      assert.equal(observationLineCollectionComplete(line), Boolean(expectedCompleted))
      assert.equal(observationSheetHasUserInput(sheet), variant !== 'unknown')
      assert.equal(
        JSON.stringify(sheet[position.side === 'baseline' ? 'candidate' : 'baseline']),
        originalOtherSide,
        'editing one store must not alter the other store',
      )
      assert.equal(
        nextIncompleteObservationLine(sheet)?.ingredientId,
        positions[expectedCompleted && position.side === 'baseline' && position.index === 0 ? 1 : 0]
          ?.ingredientId,
      )
      assert.equal(
        nextIncompleteObservationLine(sheet)?.side,
        positions[expectedCompleted && position.side === 'baseline' && position.index === 0 ? 1 : 0]
          ?.side,
      )
    }
  }
})

test('removing any one completed observed price makes exactly that line the next task', () => {
  const fullSheet = buildObservationSheet()
  markEveryLineComplete(fullSheet)
  const positions = canonicalPositions(fullSheet)
  const fullSnapshot = JSON.stringify(fullSheet)

  assert.equal(observationSheetProgress(fullSheet).completeLines, positions.length)
  assert.equal(observationSheetProgress(fullSheet).availabilityRecorded, positions.length)
  assert.equal(nextIncompleteObservationLine(fullSheet), null)

  for (const position of positions) {
    const sheet = JSON.parse(fullSnapshot)
    sheet[position.side].lines[position.index].observedProduct.priceCents = null

    assert.deepEqual(nextIncompleteObservationLine(sheet), {
      side: position.side,
      ingredientId: position.ingredientId,
    })
    assert.equal(observationSheetProgress(sheet).completeLines, positions.length - 1)
    assert.equal(observationSheetProgress(sheet).availabilityRecorded, positions.length)
    assert.equal(
      observationStoreProgress(sheet[position.side]).completeLines,
      sheet[position.side].lines.length - 1,
    )
    assert.equal(
      observationStoreProgress(sheet[position.side === 'baseline' ? 'candidate' : 'baseline'])
        .completeLines,
      sheet[position.side === 'baseline' ? 'candidate' : 'baseline'].lines.length,
    )
    assert.equal(JSON.stringify(fullSheet), fullSnapshot, 'the original sheet stays immutable')
  }
})

test('all store/ingredient positions survive draft recovery without promoting missing prices', () => {
  const template = buildObservationSheet()
  const positions = canonicalPositions(template)

  for (const position of positions) {
    const sheet = buildObservationSheet()
    markEveryLineComplete(sheet)
    const line = sheet[position.side].lines[position.index]
    line.observedProduct.priceCents = null

    const serialized = JSON.stringify(sheet)
    const restored = restoreObservationSheetDraft(serialized)

    assert.ok(restored, `valid incomplete draft ${position.side}/${position.index}`)
    assert.equal(restored.evidenceStatus, 'collection-template-not-evidence')
    assert.deepEqual(restored.requirements, sheet.requirements)
    assert.equal(restored[position.side].lines[position.index].observedProduct.priceCents, null)
    assert.equal(observationSheetProgress(restored).completeLines, positions.length - 1)
    assert.deepEqual(nextIncompleteObservationLine(restored), {
      side: position.side,
      ingredientId: position.ingredientId,
    })
    assert.equal(JSON.stringify(sheet), serialized, 'restoring may not edit the input')
  }
})
