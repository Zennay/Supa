import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Recipes,
} from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts,
  m3BaselineStore,
  m3CandidateProducts,
  m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

function completeComparisonInput() {
  return {
    baseline: buildOneStoreBasket({
      store: m3BaselineStore,
      plan: m2InitialPlan,
      recipes: m2Recipes,
      activeDays: m2DefaultActiveDays,
      products: m3BaselineProducts,
    }),
    candidate: buildOneStoreBasket({
      store: m3CandidateStore,
      plan: m2InitialPlan,
      recipes: m2Recipes,
      activeDays: m2DefaultActiveDays,
      products: m3CandidateProducts,
    }),
  }
}

test('M3 comparison rejects malformed top-level runtime containers deterministically', () => {
  for (const input of [null, undefined, [], 'invalid', 42]) {
    assert.throws(
      () => compareFullBaskets(input),
      /Basket comparison input invalid/,
    )
  }
})

test('M3 comparison rejects malformed basket runtime containers before field access', () => {
  const { baseline, candidate } = completeComparisonInput()

  assert.throws(
    () => compareFullBaskets({ baseline: null, candidate }),
    /baseline basket container invalid/,
  )
  assert.throws(
    () => compareFullBaskets({ baseline, candidate: [] }),
    /candidate basket container invalid/,
  )
  assert.throws(
    () =>
      compareFullBaskets({
        baseline: { ...baseline, store: null },
        candidate,
      }),
    /baseline basket store container invalid/,
  )
  assert.throws(
    () =>
      compareFullBaskets({
        baseline,
        candidate: { ...candidate, store: 'invalid' },
      }),
    /candidate basket store container invalid/,
  )
})

test('M3 comparison fails closed on malformed matched nested containers', () => {
  for (const [field, malformed] of [
    ['pack', null],
    ['requirement', []],
  ]) {
    const { baseline, candidate } = completeComparisonInput()
    const index = baseline.lines.findIndex((line) => line.status === 'matched')
    assert.ok(index >= 0)

    baseline.lines[index] = {
      ...baseline.lines[index],
      [field]: malformed,
    }

    const comparison = compareFullBaskets({ baseline, candidate })

    assert.equal(comparison.claimable, false)
    assert.equal(comparison.outcome, 'unknown')
    assert.equal(comparison.deltaCents, null)
    assert.equal(comparison.savingsCents, null)
    assert.match(
      comparison.reasons.join(' '),
      /unsupported line shape or status/,
    )
  }
})

test('M3 comparison preserves valid comparison behavior after container validation', () => {
  const comparison = compareFullBaskets(completeComparisonInput())

  assert.equal(comparison.claimable, true)
  assert.notEqual(comparison.outcome, 'unknown')
  assert.equal(comparison.reasons.length, 0)
})
