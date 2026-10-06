import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  nextIncompleteObservationLine,
} from '../src/domain/m3ObservationSheet.ts'
import {
  nextObservationActionLabel,
  observationSidePresentation,
  observationTimestampFromDate,
} from '../src/features/observation/observationCollectionUi.ts'

test('M3 collection UI pins the canonical retailer to each observation side', () => {
  assert.deepEqual(observationSidePresentation('baseline'), {
    expectedRetailer: 'PLUS',
    eyebrow: 'PLUS · baseline',
    storeIdPlaceholder: 'plus-leiden-...',
  })
  assert.deepEqual(observationSidePresentation('candidate'), {
    expectedRetailer: 'DekaMarkt',
    eyebrow: 'DekaMarkt · vergelijking',
    storeIdPlaceholder: 'dekamarkt-leiden-...',
  })
})

test('M3 collection UI names the exact next open retailer and ingredient', () => {
  const sheet = buildObservationSheet()

  assert.equal(
    nextObservationActionLabel(sheet, nextIncompleteObservationLine(sheet)),
    'Volgende: PLUS · Basmati rijst',
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

test('M3 current-time helper emits a stable ISO timestamp and fails closed on invalid dates', () => {
  assert.equal(
    observationTimestampFromDate(new Date('2026-10-06T07:45:12.345Z')),
    '2026-10-06T07:45:12.345Z',
  )
  assert.equal(observationTimestampFromDate(new Date('invalid')), '')
})
