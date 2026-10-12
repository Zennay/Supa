import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import {
  observationPackUnitOptions,
  observationRequiredQuantityCopy,
} from '../src/features/observation/observationQuantityPresentation.ts'

test('product #2029: negative M3 demand never appears as an instruction to buy negative quantities', () => {
  for (const unit of ['piece', 'g', 'kg', 'ml', 'l', 'unknown']) {
    for (const amount of [-1, -0.5, -0.00007]) {
      const text = observationRequiredQuantityCopy(amount, unit)
      assert.match(text, /^nodig: \? /, `${unit} ${amount}: ${text}`)
      assert.doesNotMatch(text, /nodig: -/, `${unit} ${amount}: ${text}`)
    }
  }
  assert.equal(observationRequiredQuantityCopy(-1, 'piece'), 'nodig: ? stuks')
  assert.equal(observationRequiredQuantityCopy(-1, 'unknown'), 'nodig: ? onbekend')
})

test('product #2029: invalid negative handling preserves exact zero, positive and unknown demand copy', () => {
  for (const [amount, unit, label] of [
    [0, 'piece', 'nodig: 0 stuks'],
    [1, 'piece', 'nodig: 1 stuk'],
    [2, 'piece', 'nodig: 2 stuks'],
    [0.07, 'ml', 'nodig: 0.07 ml'],
    [0.00007, 'l', 'nodig: 0.00007 l'],
    [null, 'piece', 'nodig: ? stuks'],
    [Number.NaN, 'g', 'nodig: ? g'],
    [Number.POSITIVE_INFINITY, 'l', 'nodig: ? l'],
    [Number.NEGATIVE_INFINITY, 'piece', 'nodig: ? stuks'],
  ]) {
    assert.equal(observationRequiredQuantityCopy(amount, unit), label)
  }
  assert.deepEqual(observationPackUnitOptions, [
    { value: 'g', label: 'g' },
    { value: 'kg', label: 'kg' },
    { value: 'ml', label: 'ml' },
    { value: 'l', label: 'l' },
    { value: 'piece', label: 'stuk' },
  ])
})

test('product #2029: presentation boundary does not mutate canonical field requirements', () => {
  const sheet = buildObservationSheet()
  const before = JSON.stringify(sheet)
  for (const line of sheet.baseline.lines) {
    assert.doesNotMatch(
      observationRequiredQuantityCopy(line.requirement.amount, line.requirement.unit),
      /nodig: -/,
    )
  }
  assert.equal(JSON.stringify(sheet), before)
  assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')
})
