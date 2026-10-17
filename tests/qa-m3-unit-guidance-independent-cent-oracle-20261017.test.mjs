import assert from 'node:assert/strict'
import test from 'node:test'

import { privateM3PackUnitPrice } from '../scripts/m3-private-pack-unit-price.mjs'

// Synthetic, non-retailer inputs only. Independent integer-count oracle:
// cents per 100 base units = round-half-up(priceCents * 100 / (baseUnits * count)).
// The published comparison must NEVER derive its whole-basket sum from this label.
function oracle(priceCents, baseUnits, count, per = 100) {
  const numerator = BigInt(priceCents) * BigInt(per)
  const denominator = BigInt(baseUnits) * BigInt(count)
  const rounded = (2n * numerator + denominator) / (2n * denominator)
  return {
    cents: Number(rounded),
    approximate: numerator % denominator !== 0n,
  }
}

function product(packAmount, packUnit, pricePerPackageCents, itemsPerPackage) {
  return Object.freeze({
    status: 'known',
    packAmount,
    packUnit,
    pricePerPackageCents,
    itemsPerPackage,
  })
}

test('M3 independent exact-cent oracle: 2,200 metric mass and volume pack cases, invariant under g/kg or ml/l', () => {
  const sizes = [125, 250, 375, 500, 750, 1000, 1250, 2000, 2500, 3000]
  const prices = [0, 1, 2, 5, 15, 99, 100, 101, 109, 999, 9999]
  const counts = [1, 2, 3, 4, 12]
  let scenarios = 0
  for (const family of [
    { base: 'g', kilo: 'kg', basis: '100 g' },
    { base: 'ml', kilo: 'l', basis: '100 ml' },
  ]) {
    for (const size of sizes) for (const price of prices) for (const count of counts) {
      const expected = { ...oracle(price, size, count), basis: family.basis }
      for (const [quantity, unit] of [[size, family.base], [size / 1000, family.kilo]]) {
        const input = product(quantity, unit, price, count)
        const actual = privateM3PackUnitPrice(input)
        assert.deepEqual(actual, expected,
          family.basis + ' ' + size + ' ' + unit + '/' + count + ' @' + price)
        assert.equal(Object.isFrozen(input), true)
        scenarios++
      }
    }
  }
  assert.equal(scenarios, 2200)
})

test('M3 independent per-piece oracle: 396 price, multiplicity and count combinations', () => {
  const prices = [0, 1, 2, 3, 5, 99, 100, 101, 199, 999, 9999]
  let checked = 0
  for (const units of [1, 2, 3, 4, 6, 8]) {
    for (const packs of [1, 2, 3, 5, 10, 12]) {
      for (const price of prices) {
        const expected = { ...oracle(price, units, packs, 1), basis: 'stuk' }
        assert.deepEqual(privateM3PackUnitPrice(product(units, 'piece', price, packs)),
          expected, 'pieces=' + units + ', count=' + packs + ', cents=' + price)
        checked++
      }
    }
  }
  assert.equal(checked, 396)
})

test('M3 display rounding ties resolve half-up, including zero price and sub-cent rates', () => {
  const vectors = [
    // 1c / 200g * 100g => 0.5 cents (half up).
    [200, 'g', 1, 1, 1, true],
    [400, 'g', 1, 1, 0, true],
    [100, 'g', 0, 1, 0, false],
    [1, 'piece', 1, 2, 1, true],
    [1, 'piece', 1, 4, 0, true],
    [1000, 'ml', 1, 1, 0, true],
    [500, 'g', 5, 1, 1, false],
  ]
  for (const [amount, unit, cents, count, expectedCents, approximate] of vectors) {
    const actual = privateM3PackUnitPrice(product(amount, unit, cents, count))
    assert.equal(actual?.cents, expectedCents,
      'rounded display ' + amount + ' ' + unit + ' cents=' + cents)
    assert.equal(actual?.approximate, approximate)
  }
})

test('M3 ineligible packs never yield authoritative unit prices or modify frozen originals', () => {
  const invalid = [
    { status: 'unresolved' }, { pricePerPackageCents: -1 },
    { pricePerPackageCents: Number.POSITIVE_INFINITY },
    { pricePerPackageCents: Number.MAX_SAFE_INTEGER + 1 },
    { pricePerPackageCents: 0.1 },
    { itemsPerPackage: 0 }, { itemsPerPackage: -1 }, { itemsPerPackage: 1.5 },
    { packAmount: 0 }, { packAmount: -0.1 }, { packAmount: NaN },
    { packAmount: Infinity }, { packAmount: Number.MIN_VALUE },
    { packUnit: 'oz' }, { packUnit: 'lb' }, { packUnit: 'cups' },
    { packUnit: '__proto__' }, { packUnit: 'toString' },
    { packUnit: '' }, { packUnit: null },
  ]
  const valid = product(500, 'g', 120, 1)
  for (const fields of invalid) {
    const candidate = Object.freeze({ ...valid, ...fields })
    const before = Object.getOwnPropertyDescriptors(candidate)
    assert.equal(privateM3PackUnitPrice(candidate), null, JSON.stringify(fields))
    assert.deepEqual(Object.getOwnPropertyDescriptors(candidate), before)
  }
})
