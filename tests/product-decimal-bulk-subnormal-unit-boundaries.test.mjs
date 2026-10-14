import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calculateDecimalPackCount,
  sumDecimalAmounts,
  sumDecimalDemandUnits,
} from '../src/domain/decimalPackArithmetic.ts'

// Independent product-core regression for #1402, stacked on the immutable
// postrepair acceptance #1497. All demands are synthetic; no retailer price
// observations or real-world savings are asserted.
const MAX_LINES = 10_000
const tiny = 1e-323
const tinyAmounts = Object.freeze(Array.from({ length: MAX_LINES }, () => tiny))
const massRequirements = Object.freeze(Array.from(
  { length: MAX_LINES },
  () => Object.freeze({ amount: tiny, unit: 'g' }),
))
const volumeRequirements = Object.freeze(Array.from(
  { length: MAX_LINES },
  () => Object.freeze({ amount: tiny, unit: 'ml' }),
))

test('maximum supported same-unit line count preserves an exact subnormal sum', () => {
  assert.equal(sumDecimalAmounts(tinyAmounts), 1e-319)
  assert.equal(sumDecimalAmounts([...tinyAmounts].reverse()), 1e-319)
  assert.equal(sumDecimalAmounts([0.1, 0.2]), 0.3)
})

test('mass units aggregate before converting individually unrepresentable amounts', () => {
  // Each 1e-323 g is smaller than the smallest representable kg Number.
  // Converting each requirement first would lose every line.
  assert.equal(sumDecimalDemandUnits(massRequirements, 'g'), 1e-319)
  assert.equal(sumDecimalDemandUnits(massRequirements, 'kg'), 1e-322)
  assert.equal(
    calculateDecimalPackCount(massRequirements, { amount: 1e-322, unit: 'kg' }),
    1,
    'full exact physical demand fits one equal-size pack',
  )
  assert.equal(
    calculateDecimalPackCount(massRequirements, { amount: 5e-323, unit: 'kg' }),
    2,
    'half-size physical packs require exactly two packages',
  )
})

test('volume units preserve the same 1000-to-one conversion without early underflow', () => {
  assert.equal(sumDecimalDemandUnits(volumeRequirements, 'ml'), 1e-319)
  assert.equal(sumDecimalDemandUnits(volumeRequirements, 'l'), 1e-322)
  assert.equal(
    calculateDecimalPackCount(volumeRequirements, { amount: 1e-322, unit: 'l' }),
    1,
  )
})

test('10,001 demands fail closed, including arithmetic and physical pack count', () => {
  const tooManyAmounts = [...tinyAmounts, tiny]
  const tooManyRequirements = [...massRequirements, { amount: tiny, unit: 'g' }]
  assert.equal(sumDecimalAmounts(tooManyAmounts), null)
  assert.equal(sumDecimalDemandUnits(tooManyRequirements, 'kg'), null)
  assert.equal(
    calculateDecimalPackCount(tooManyRequirements, { amount: 1e-322, unit: 'kg' }),
    null,
  )
  assert.equal(massRequirements.length, MAX_LINES)
  assert.equal(massRequirements[0].amount, tiny)
  assert.equal(massRequirements.at(-1).amount, tiny)
})
