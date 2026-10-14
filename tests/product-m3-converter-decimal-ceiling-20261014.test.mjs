import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { calculateDecimalPackCount } from '../src/domain/decimalPackArithmetic.ts'

// Only fictional values. The M3 field evidence gate #78 remains human-only.
test('canonical M3 converter uses decimal-exact whole-pack ceilings, never an IEEE-754 extra pack', () => {
  const sheet = buildFictionalPricedSheet()
  const riceIndex = sheet.requirements.findIndex((entry) =>
    entry.amount === 450 && entry.unit === 'g')
  assert.notEqual(riceIndex, -1, 'canonical 450 g rice demand is required')

  // 450 / 0.144 is exactly 3,125 in decimal arithmetic. Floating division
  // evaluates slightly above 3,125 and Math.ceil incorrectly orders 3,126.
  sheet.baseline.lines[riceIndex].observedProduct.packAmount = 0.144
  sheet.baseline.lines[riceIndex].observedProduct.packUnit = 'g'
  sheet.baseline.lines[riceIndex].observedProduct.packCount = 1
  const before = JSON.stringify(sheet)

  assert.equal(calculateDecimalPackCount(
    [{ amount: 450, unit: 'g' }],
    { amount: 0.144, unit: 'g', count: 1 },
  ), 3125)

  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const rice = study.baseline.basket.lines[riceIndex]
  assert.equal(rice.status, 'matched')
  assert.equal(rice.packs, 3125)
  assert.equal(rice.lineTotalCents, 312500)
  assert.equal(study.baseline.basket.totalCents, 313500)
  assert.equal(JSON.stringify(sheet), before, 'observation source is immutable')
})

test('canonical M3 conversion retains normal matched packs and explicit unavailable outcomes', () => {
  const sheet = buildFictionalPricedSheet()
  const baseline = buildWeeklyBasketStudyFromObservationSheet(sheet)
  assert.equal(baseline.baseline.basket.matchedLineCount, 11)
  assert.equal(baseline.baseline.basket.totalCents, 1100)

  sheet.baseline.lines[0].observedProduct.available = false
  const partial = buildWeeklyBasketStudyFromObservationSheet(sheet)
  assert.equal(partial.baseline.basket.lines[0].status, 'unresolved')
  assert.equal(partial.baseline.basket.totalCents, 1000)
  assert.equal(partial.baseline.basket.unresolvedLineCount, 1)
})

test('canonical M3 converter handles decimal multipacks and compatible kg-to-g units exactly', () => {
  const riceIndex = buildFictionalPricedSheet().requirements.findIndex(
    (entry) => entry.amount === 450 && entry.unit === 'g',
  )
  assert.notEqual(riceIndex, -1)

  for (const [packAmount, packUnit, packCount, expectedPacks] of [
    [0.072, 'g', 2, 3125],
    [0.000144, 'kg', 1, 3125],
    [0.3, 'g', 1, 1500],
    [0.144, 'g', 3, 1042],
  ]) {
    const sheet = buildFictionalPricedSheet()
    const product = sheet.baseline.lines[riceIndex].observedProduct
    product.packAmount = packAmount
    product.packUnit = packUnit
    product.packCount = packCount
    const before = JSON.stringify(sheet)
    const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
    const rice = study.baseline.basket.lines[riceIndex]
    assert.equal(rice.status, 'matched', 'trusted fictional rice stays matched')
    assert.equal(rice.packs, expectedPacks)
    assert.equal(rice.lineTotalCents, expectedPacks * 100)
    assert.equal(study.baseline.basket.totalCents, expectedPacks * 100 + 1000)
    assert.equal(JSON.stringify(sheet), before, 'converter must not change the human sheet')
  }
})

test('unsafe observed pack arithmetic fails closed without inventing a price', () => {
  const sheet = buildFictionalPricedSheet()
  const riceIndex = sheet.requirements.findIndex(
    (entry) => entry.amount === 450 && entry.unit === 'g',
  )
  const product = sheet.baseline.lines[riceIndex].observedProduct
  // Required packs exceed the safe-integer range. No half-trusted money may
  // survive as a matched line, even when the product text is a perfect match.
  product.packAmount = 1e-20
  product.packUnit = 'g'
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const rice = study.baseline.basket.lines[riceIndex]
  assert.equal(rice.status, 'unresolved')
  assert.equal(study.baseline.basket.unresolvedLineCount, 1)
  assert.equal(study.baseline.basket.totalCents, 1000)
})
