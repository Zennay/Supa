import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import {
  observationPackUnitOptions,
  observationRequiredQuantityCopy,
} from '../src/features/observation/observationQuantityPresentation.ts'

test('product #756: pack selector labels are Dutch but submitted canonical units stay exact', () => {
  assert.deepEqual(observationPackUnitOptions, [
    { value: 'g', label: 'g' },
    { value: 'kg', label: 'kg' },
    { value: 'ml', label: 'ml' },
    { value: 'l', label: 'l' },
    { value: 'piece', label: 'stuk' },
  ])
  assert.equal(Object.isFrozen(observationPackUnitOptions), true)
  assert.ok(observationPackUnitOptions.every(Object.isFrozen))
  assert.equal(
    new Set(observationPackUnitOptions.map(({ value }) => value)).size,
    observationPackUnitOptions.length,
  )
  assert.ok(observationPackUnitOptions.every(({ label }) => label !== 'piece'))
})

test('product #756: observed M3 demand shows natural Dutch piece and unknown copy', () => {
  assert.equal(observationRequiredQuantityCopy(1, 'piece'), 'nodig: 1 stuk')
  assert.equal(observationRequiredQuantityCopy(2, 'piece'), 'nodig: 2 stuks')
  assert.equal(observationRequiredQuantityCopy(0, 'piece'), 'nodig: 0 stuks')
  assert.equal(observationRequiredQuantityCopy(4, 'unknown'), 'nodig: 4 onbekend')
  assert.equal(observationRequiredQuantityCopy(null, 'unknown'), 'nodig: ? onbekend')
  assert.equal(observationRequiredQuantityCopy(null, 'piece'), 'nodig: ? stuks')
})

test('product #756: mass and volume demand values are not converted or rounded for display', () => {
  for (const [amount, unit, expected] of [
    [0.07, 'ml', 'nodig: 0.07 ml'],
    [0.00007, 'l', 'nodig: 0.00007 l'],
    [200, 'g', 'nodig: 200 g'],
    [0.2, 'kg', 'nodig: 0.2 kg'],
  ]) {
    assert.equal(observationRequiredQuantityCopy(amount, unit), expected)
  }
  assert.equal(
    observationRequiredQuantityCopy(Number.NaN, 'piece'),
    'nodig: ? stuks',
  )
  assert.equal(
    observationRequiredQuantityCopy(Number.POSITIVE_INFINITY, 'unknown'),
    'nodig: ? onbekend',
  )
  assert.equal(
    observationRequiredQuantityCopy(1, 'pcs'),
    'nodig: 1 onbekend',
  )
})

test('product #756: genuine empty two-store collection template keeps its canonical demand and status', () => {
  const sheet = buildObservationSheet()
  const before = JSON.stringify(sheet)
  const baselineLabels = sheet.baseline.lines.map(({ requirement }) =>
    observationRequiredQuantityCopy(requirement.amount, requirement.unit),
  )
  const candidateLabels = sheet.candidate.lines.map(({ requirement }) =>
    observationRequiredQuantityCopy(requirement.amount, requirement.unit),
  )
  assert.equal(baselineLabels.length, 11)
  assert.deepEqual(baselineLabels, candidateLabels)
  assert.ok(sheet.baseline.lines.some(({ requirement }) => requirement.unit === 'piece'))
  assert.ok(baselineLabels.some((value) => /\bstuk(?:s)?\b/.test(value)))
  assert.ok(baselineLabels.every((value) => !/\bpiece\b|\bunknown\b/.test(value)))
  assert.equal(JSON.stringify(sheet), before)
  assert.ok(sheet.baseline.lines.every((line) => line.observedProduct.available === null))
  assert.ok(sheet.candidate.lines.every((line) => line.observedProduct.available === null))
})
