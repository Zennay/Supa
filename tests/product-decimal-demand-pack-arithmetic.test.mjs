import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calculateDecimalPackCount,
  sumDecimalAmounts,
} from '../src/domain/decimalPackArithmetic.ts'

test('summing decimal ingredient demand never introduces phantom fractional overage', () => {
  assert.equal(0.1 + 0.2, 0.30000000000000004)
  assert.equal(sumDecimalAmounts([0.1, 0.2]), 0.3)
  assert.equal(sumDecimalAmounts([0.1, 0.2, 0.05]), 0.35)
  assert.equal(sumDecimalAmounts([0.000001, 0.000002]), 0.000003)
  assert.equal(sumDecimalAmounts([1, 2, 3]), 6)
  assert.equal(sumDecimalAmounts([0.2, 0.1]), sumDecimalAmounts([0.1, 0.2]))
})

test('fractional repeated recipes buy the exact number of packs', () => {
  const demands = [
    { amount: 0.1, unit: 'g' },
    { amount: 0.2, unit: 'g' },
  ]
  const pack = { amount: 0.3, unit: 'g' }

  assert.equal(calculateDecimalPackCount(demands, pack), 1)
  assert.equal(calculateDecimalPackCount(demands, { ...pack, amount: 0.1 }), 3)
  assert.equal(calculateDecimalPackCount(demands, { ...pack, amount: 0.29 }), 2)
  assert.equal(calculateDecimalPackCount(demands, { ...pack, amount: 0.15 }), 2)
  assert.equal(calculateDecimalPackCount(demands, { ...pack, count: 2, amount: 0.15 }), 1)
  assert.equal(calculateDecimalPackCount([...demands].reverse(), pack), 1)
  assert.deepEqual(demands, [
    { amount: 0.1, unit: 'g' },
    { amount: 0.2, unit: 'g' },
  ])
})

test('tiny but genuine overshoot must still buy the extra pack', () => {
  assert.equal(
    calculateDecimalPackCount(
      [{ amount: 0.1, unit: 'g' }, { amount: 0.200000000000001, unit: 'g' }],
      { amount: 0.3, unit: 'g' },
    ),
    2,
  )
  assert.equal(
    calculateDecimalPackCount([{ amount: 0.30000000000000004, unit: 'g' }], { amount: 0.3, unit: 'g' }),
    2,
    'the already-corrupted floating sum cannot be repaired after the fact',
  )
  assert.equal(calculateDecimalPackCount([{ amount: 0.07, unit: 'g' }], { amount: 0.01, unit: 'g' }), 7)
  assert.equal(calculateDecimalPackCount([{ amount: 0.28, unit: 'ml' }], { amount: 0.04, unit: 'ml' }), 7)
})

test('normalize metric units before exact ceiling and preserve piece quantities', () => {
  assert.equal(calculateDecimalPackCount([{ amount: 0.1, unit: 'kg' }, { amount: 200, unit: 'g' }], { amount: 0.3, unit: 'kg' }), 1)
  assert.equal(calculateDecimalPackCount([{ amount: 0.1, unit: 'l' }, { amount: 200, unit: 'ml' }], { amount: 300, unit: 'ml' }), 1)
  assert.equal(calculateDecimalPackCount([{ amount: 1, unit: 'piece' }, { amount: 2, unit: 'piece' }], { amount: 2, unit: 'piece' }), 2)
  assert.equal(calculateDecimalPackCount([{ amount: 0.301, unit: 'kg' }], { amount: 300, unit: 'g' }), 2)
})

test('160 synthetic decimal pack boundaries are mathematically consistent', () => {
  let tested = 0
  for (const family of ['g', 'ml']) {
    for (let tenth = 1; tenth <= 40; tenth++) {
      const first = tenth / 10
      const demands = [{ amount: first, unit: family }, { amount: 0.2, unit: family }]
      const exactTenths = tenth + 2
      const exactPackTenths = 3
      const expected = Math.ceil(exactTenths / exactPackTenths)
      const actual = calculateDecimalPackCount(demands, { amount: 0.3, unit: family })
      assert.equal(actual, expected, `${family} at ${tenth} tenths`)
      tested++
    }
    for (let hundredth = 1; hundredth <= 40; hundredth++) {
      const demands = [
        { amount: hundredth / 100, unit: family },
        { amount: 0.02, unit: family },
      ]
      const expected = Math.ceil((hundredth + 2) / 7)
      assert.equal(
        calculateDecimalPackCount(demands, { amount: 0.07, unit: family }),
        expected,
        `${family} at ${hundredth} hundredths`,
      )
      tested++
    }
  }
  assert.equal(tested, 160)
})

test('reject invalid, mixed-family and unbounded arithmetic inputs rather than guessing pack counts', () => {
  const valid = [{ amount: 0.1, unit: 'g' }]
  const pack = { amount: 0.3, unit: 'g' }
  for (const demands of [
    [], null, 'bad', [{ amount: 0, unit: 'g' }],
    [{ amount: -1, unit: 'g' }],
    [{ amount: Number.NaN, unit: 'g' }],
    [{ amount: Number.POSITIVE_INFINITY, unit: 'g' }],
    [{ amount: 0.1, unit: 'unknown' }],
    [{ amount: 1, unit: 'piece' }],
    [null],
  ]) {
    assert.equal(calculateDecimalPackCount(demands, pack), null)
  }
  for (const badPack of [
    null, [], { amount: 0, unit: 'g' }, { amount: -1, unit: 'g' },
    { amount: 0.3, unit: 'unknown' }, { amount: 0.3, unit: 'piece' },
    { amount: Number.POSITIVE_INFINITY, unit: 'g' },
    { amount: 0.3, unit: 'g', count: 0 },
    { amount: 0.3, unit: 'g', count: 0.5 },
    { amount: 0.3, unit: 'g', count: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    assert.equal(calculateDecimalPackCount(valid, badPack), null)
  }
  for (const invalid of [
    [], null, [0], [-1], [Number.NaN], [0.1, Number.POSITIVE_INFINITY],
    [0.1, 0.2, Number.MIN_VALUE],
  ]) {
    assert.equal(sumDecimalAmounts(invalid), null)
  }
  assert.equal(
    calculateDecimalPackCount([{ amount: 1e18, unit: 'piece' }], { amount: 1, unit: 'piece' }),
    null,
    'a pack count exceeding Number.MAX_SAFE_INTEGER is not representable',
  )
})
