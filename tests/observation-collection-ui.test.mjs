import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  nextIncompleteObservationLine,
} from '../src/domain/m3ObservationSheet.ts'
import {
  nextObservationActionLabel,
  observationTimestampFromDate,
} from '../src/features/observation/observationCollectionUi.ts'

test('M3 collection guidance names the exact next retailer and ingredient', () => {
  const sheet = buildObservationSheet()

  assert.equal(
    nextObservationActionLabel(sheet, nextIncompleteObservationLine(sheet)),
    'Volgende: PLUS · Basmati rijst',
  )

  sheet.baseline.lines[0].observedProduct.available = false

  assert.equal(
    nextObservationActionLabel(sheet, nextIncompleteObservationLine(sheet)),
    'Volgende: PLUS · Broccoli',
  )

  sheet.baseline.lines.forEach((line) => {
    line.observedProduct.available = false
  })

  assert.equal(
    nextObservationActionLabel(sheet, nextIncompleteObservationLine(sheet)),
    'Volgende: DekaMarkt · Basmati rijst',
  )

  sheet.candidate.lines.forEach((line) => {
    line.observedProduct.available = false
  })

  assert.equal(
    nextObservationActionLabel(sheet, nextIncompleteObservationLine(sheet)),
    'Alle regels zijn gemeten',
  )
})

test('M3 current-time helper emits ISO evidence time and fails closed for invalid dates', () => {
  assert.equal(
    observationTimestampFromDate(new Date('2026-10-06T07:45:12.345Z')),
    '2026-10-06T07:45:12.345Z',
  )
  assert.equal(observationTimestampFromDate(new Date('invalid')), '')
})
