import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calculateDecimalPackCount,
  sumDecimalAmounts,
  sumDecimalDemandUnits,
} from '../src/domain/decimalPackArithmetic.ts'

// #1402: high-cardinality *ordinary* recipe demand alongside the independent
// subnormal test. All example quantities are synthetic, not retailer evidence.
const COUNT = 10_000
const mixedMass = Object.freeze(Array.from({ length: COUNT }, (_, i) =>
  Object.freeze(i % 2 === 0
    ? { amount: 0.01, unit: 'g' }
    : { amount: 0.00001, unit: 'kg' }),
))
const mixedVolume = Object.freeze(Array.from({ length: COUNT }, (_, i) =>
  Object.freeze(i % 2 === 0
    ? { amount: 0.01, unit: 'ml' }
    : { amount: 0.00001, unit: 'l' }),
))

test('10k normal decimal recipe amounts aggregate to exactly 100g', () => {
  assert.equal(sumDecimalAmounts(Array(COUNT).fill(0.01)), 100)
  assert.equal(sumDecimalDemandUnits(mixedMass, 'g'), 100)
  assert.equal(sumDecimalDemandUnits(mixedMass, 'kg'), 0.1)
  assert.equal(sumDecimalDemandUnits([...mixedMass].reverse(), 'g'), 100)
})

test('mixed mass demands hit the exact pack ceiling without phantom packs', () => {
  assert.equal(
    calculateDecimalPackCount(mixedMass, { amount: 0.1, unit: 'kg' }),
    1,
    '100g precisely fits one 100g pack',
  )
  assert.equal(
    calculateDecimalPackCount(mixedMass, { amount: 99.99, unit: 'g' }),
    2,
    'one hundredth of a gram below required capacity needs a second pack',
  )
  assert.equal(
    calculateDecimalPackCount(mixedMass, { amount: 0.05, unit: 'kg', count: 2 }),
    1,
    'a two-item multipack contains 100g total',
  )
})

test('mixed volume demands preserve exact ml/l conversion and physical packs', () => {
  assert.equal(sumDecimalDemandUnits(mixedVolume, 'ml'), 100)
  assert.equal(sumDecimalDemandUnits(mixedVolume, 'l'), 0.1)
  assert.equal(
    calculateDecimalPackCount(mixedVolume, { amount: 0.1, unit: 'l' }),
    1,
  )
  assert.equal(
    calculateDecimalPackCount(mixedVolume, { amount: 99.99, unit: 'ml' }),
    2,
  )
  assert.equal(mixedMass[0].amount, 0.01)
  assert.equal(mixedMass[1].amount, 0.00001)
  assert.equal(mixedVolume[0].unit, 'ml')
  assert.equal(mixedVolume[1].unit, 'l')
})

test('10,001 mixed-unit lines never trigger unsafe conversion or pack calculations', () => {
  const excess = [...mixedMass, { amount: 0.01, unit: 'g' }]
  assert.equal(sumDecimalDemandUnits(excess, 'g'), null)
  assert.equal(calculateDecimalPackCount(excess, { amount: 0.1, unit: 'kg' }), null)
  assert.equal(mixedMass.length, COUNT)
})
