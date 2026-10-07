import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { nextObservationActionLabel } from '../src/features/observation/observationCollectionUi.ts'

const nextBaselineRice = {
  side: 'baseline',
  ingredientId: 'basmati-rice',
}

const nextCandidateRice = {
  side: 'candidate',
  ingredientId: 'basmati-rice',
}

test('observation action label rejects malformed sheet containers deterministically', () => {
  for (const malformed of [null, undefined, false, 0, '', [], {}]) {
    assert.throws(
      () => nextObservationActionLabel(malformed, nextBaselineRice),
      /invalid observation sheet/,
    )
  }
})

test('observation action label never reports completion from malformed or incomplete state', () => {
  for (const malformed of [
    null,
    {},
    { baseline: { lines: [] }, candidate: null },
    { baseline: { lines: [] }, candidate: { lines: null } },
  ]) {
    assert.throws(
      () => nextObservationActionLabel(malformed, null),
      /invalid observation sheet/,
    )
  }

  assert.throws(
    () => nextObservationActionLabel(buildObservationSheet(), null),
    /observation sheet is not complete/,
  )

  const malformedLineSheet = buildObservationSheet()
  malformedLineSheet.baseline.lines = [null, ...malformedLineSheet.baseline.lines]
  assert.throws(
    () => nextObservationActionLabel(malformedLineSheet, null),
    /invalid observation sheet/,
  )

  const complete = buildObservationSheet()
  for (const side of ['baseline', 'candidate']) {
    complete[side].lines.forEach((line) => {
      line.observedProduct.available = false
    })
  }

  assert.equal(
    nextObservationActionLabel(complete, null),
    'Alle regels zijn gemeten',
  )
})

test('observation action label rejects malformed selected-side containers', () => {
  for (const baseline of [null, undefined, false, 0, '', [], { lines: null }]) {
    assert.throws(
      () =>
        nextObservationActionLabel(
          { baseline, candidate: { lines: [] } },
          nextBaselineRice,
        ),
      /invalid observation sheet/,
    )
  }
})

test('observation action label rejects malformed unselected-side containers', () => {
  const sheet = buildObservationSheet()

  for (const candidate of [null, undefined, false, 0, '', [], { lines: null }]) {
    assert.throws(
      () =>
        nextObservationActionLabel(
          { baseline: sheet.baseline, candidate },
          nextBaselineRice,
        ),
      /invalid observation sheet/,
    )
  }

  for (const baseline of [null, undefined, false, 0, '', [], { lines: null }]) {
    assert.throws(
      () =>
        nextObservationActionLabel(
          { baseline, candidate: sheet.candidate },
          nextCandidateRice,
        ),
      /invalid observation sheet/,
    )
  }
})

test('observation action label rejects padded ingredient IDs', () => {
  const sheet = buildObservationSheet()

  for (const ingredientId of [' basmati-rice', 'basmati-rice ']) {
    assert.throws(
      () =>
        nextObservationActionLabel(sheet, {
          side: 'baseline',
          ingredientId,
        }),
      /invalid next observation target/,
    )
  }
})

test('observation action label rejects targets that do not exist in the selected sheet side', () => {
  const sheet = buildObservationSheet()

  assert.throws(
    () =>
      nextObservationActionLabel(sheet, {
        side: 'baseline',
        ingredientId: 'missing-line',
      }),
    /invalid next observation target/,
  )
})

test('observation action label rejects stale targets whose matching line is already complete', () => {
  const sheet = buildObservationSheet()
  const matching = sheet.baseline.lines.find(
    (line) => line.ingredientId === nextBaselineRice.ingredientId,
  )

  matching.observedProduct.available = false

  assert.throws(
    () => nextObservationActionLabel(sheet, nextBaselineRice),
    /invalid next observation target/,
  )
})

test('observation action label rejects ambiguous duplicate incomplete matches', () => {
  const sheet = buildObservationSheet()
  const matching = sheet.baseline.lines.find(
    (line) => line.ingredientId === nextBaselineRice.ingredientId,
  )
  const duplicate = structuredClone(matching)

  duplicate.ingredientLabel = 'Misleidende dubbele regel'
  sheet.baseline.lines.push(duplicate)

  assert.throws(
    () => nextObservationActionLabel(sheet, nextBaselineRice),
    /invalid next observation target/,
  )
})

test('observation action label ignores completed duplicate copy when an incomplete match remains', () => {
  const sheet = buildObservationSheet()
  const matching = sheet.baseline.lines.find(
    (line) => line.ingredientId === nextBaselineRice.ingredientId,
  )
  const completedDuplicate = structuredClone(matching)

  completedDuplicate.ingredientLabel = 'Verkeerde voltooide regel'
  completedDuplicate.observedProduct.available = false
  sheet.baseline.lines.push(completedDuplicate)

  assert.equal(
    nextObservationActionLabel(sheet, nextBaselineRice),
    'Volgende: PLUS · Basmati rijst',
  )
})

test('observation action label ignores malformed line entries and keeps valid copy', () => {
  const sheet = buildObservationSheet()
  sheet.baseline.lines = [
    null,
    42,
    [],
    { ingredientId: 'basmati-rice' },
    ...sheet.baseline.lines,
  ]

  assert.equal(
    nextObservationActionLabel(sheet, nextBaselineRice),
    'Volgende: PLUS · Basmati rijst',
  )
})

test('observation action label falls back when matching line label is malformed', () => {
  const sheet = buildObservationSheet()
  const matching = sheet.baseline.lines.find(
    (line) => line.ingredientId === 'basmati-rice',
  )

  matching.ingredientLabel = null

  assert.equal(
    nextObservationActionLabel(sheet, nextBaselineRice),
    'Volgende open regel bij PLUS',
  )
})
