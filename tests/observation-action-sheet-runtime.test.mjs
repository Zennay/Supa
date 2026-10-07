import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { nextObservationActionLabel } from '../src/features/observation/observationCollectionUi.ts'

const nextBaselineRice = {
  side: 'baseline',
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

test('observation action label never reports completion from a malformed sheet', () => {
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

  assert.equal(
    nextObservationActionLabel(buildObservationSheet(), null),
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
