import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calculateDecimalPackCount,
  sumDecimalAmounts,
} from '../src/domain/decimalPackArithmetic.ts'

// Entirely synthetic units and amounts: this is arithmetic regression evidence,
// not a retailer observation, a pack-size recommendation or a savings claim.
const families = [
  { large: 'kg', small: 'g' },
  { large: 'l', small: 'ml' },
]

test('mixed metric units hit exact boundary without an extra pack, yet preserve real 0.001-base-unit overage', () => {
  let cases = 0

  for (const { large, small } of families) {
    for (let n = 1; n <= 20; n++) {
      const atBoundary = Object.freeze([
        Object.freeze({ amount: n / 1000, unit: large }),
        Object.freeze({ amount: 100 - n, unit: small }),
      ])
      const underBoundary = Object.freeze([
        atBoundary[0],
        Object.freeze({ amount: 100 - n - 0.001, unit: small }),
      ])
      const overBoundary = Object.freeze([
        atBoundary[0],
        Object.freeze({ amount: 100 - n + 0.001, unit: small }),
      ])

      const onePack = Object.freeze({ amount: 0.1, unit: large, count: 1 })
      const twoPacks = Object.freeze({ amount: 0.1, unit: large, count: 2 })
      const smallerPack = Object.freeze({ amount: 0.05, unit: large })
      const label = `${large}/${small}, part ${n}`

      assert.equal(calculateDecimalPackCount(atBoundary, onePack), 1, label)
      assert.equal(calculateDecimalPackCount([...atBoundary].reverse(), onePack), 1, label)
      assert.equal(calculateDecimalPackCount(underBoundary, onePack), 1, label)
      assert.equal(calculateDecimalPackCount(overBoundary, onePack), 2, label)

      assert.equal(calculateDecimalPackCount(atBoundary, twoPacks), 1, label)
      assert.equal(calculateDecimalPackCount(overBoundary, twoPacks), 1, label)

      assert.equal(calculateDecimalPackCount(atBoundary, smallerPack), 2, label)
      assert.equal(calculateDecimalPackCount(overBoundary, smallerPack), 3, label)
      assert.equal(calculateDecimalPackCount(underBoundary, smallerPack), 2, label)

      // Same two quantities expressed in the large unit must add to exactly
      // 0.1, not 0.10000000000000002 via binary accumulation.
      assert.equal(
        sumDecimalAmounts([n / 1000, (100 - n) / 1000]),
        0.1,
        label,
      )
      cases += 10
    }
  }

  assert.equal(cases, 400)
})

test('decimal pack counts distinguish true precision overshoot from IEEE-754 addition drift', () => {
  for (const unit of ['g', 'ml', 'piece']) {
    const exactMeals = [
      { amount: 0.1, unit },
      { amount: 0.1, unit },
      { amount: 0.1, unit },
    ]
    const trueOverage = [
      { amount: 0.1, unit },
      { amount: 0.1, unit },
      { amount: 0.10000000000000002, unit },
    ]
    const pack = { amount: 0.3, unit }
    assert.equal(0.1 + 0.1 + 0.1, 0.30000000000000004)
    assert.equal(sumDecimalAmounts(exactMeals.map(({ amount }) => amount)), 0.3)
    assert.equal(calculateDecimalPackCount(exactMeals, pack), 1)
    assert.equal(calculateDecimalPackCount([...exactMeals].reverse(), pack), 1)
    assert.equal(calculateDecimalPackCount(trueOverage, pack), 2)
    assert.equal(calculateDecimalPackCount(
      [{ amount: 0.30000000000000004, unit }], pack,
    ), 2, 'an already-corrupted single amount must not be rounded away')
  }
})
