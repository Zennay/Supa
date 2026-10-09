import assert from 'node:assert/strict'
import test from 'node:test'

import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { euro } from '../src/lib/money.ts'

test('M2: ordinary remaining budget stays exact at the strict formatter boundary', () => {
  const assessment = assessPlannerBudgetCents(1969, 35, 0)

  assert.equal(assessment.status, 'known')
  assert.equal(assessment.remainingCents, 1531)
  assert.equal(assessment.remainingLabel, euro.formatCents(1531))
  assert.notEqual(assessment.remainingLabel, '—')
  assert.equal(assessment.overBudget, false)
  assert.equal(assessment.usage, 1969 / 3500)

  // The previous euro subtraction can yield a noncanonical 15.309999...
  assert.equal(euro.format(35 - 19.69), '—')
})

test('M2: over-budget and equality outcomes preserve their exact cent sign', () => {
  const over = assessPlannerBudgetCents(4001, 35, 0)
  assert.equal(over.status, 'known')
  assert.equal(over.remainingCents, -501)
  assert.equal(over.remainingLabel, euro.formatCents(-501))
  assert.equal(over.overBudget, true)
  assert.equal(over.usage, 1)

  const equal = assessPlannerBudgetCents(3500, 35, 0)
  assert.equal(equal.status, 'known')
  assert.equal(equal.remainingCents, 0)
  assert.equal(equal.overBudget, false)
  assert.equal(equal.remainingLabel, euro.formatCents(0))
})

test('M2: zero budget retains legacy full progress without an under-budget claim', () => {
  const free = assessPlannerBudgetCents(0, 0, 0)
  assert.equal(free.status, 'known')
  assert.equal(free.remainingCents, 0)
  assert.equal(free.usage, 1)

  const spending = assessPlannerBudgetCents(1, 0, 0)
  assert.equal(spending.status, 'known')
  assert.equal(spending.remainingCents, -1)
  assert.equal(spending.overBudget, true)
})

test('M2: incomplete baskets expose only a known minimum, never a budget remainder', () => {
  const incomplete = assessPlannerBudgetCents(1969, 35, 1)
  assert.deepEqual(incomplete, {
    status: 'unknown',
    reason: 'unresolved-products',
    budgetCents: 3500,
    knownMinimumCents: 1969,
    unresolvedLineCount: 1,
  })
  assert.equal('remainingCents' in incomplete, false)
  assert.equal('remainingLabel' in incomplete, false)
  assert.equal('overBudget' in incomplete, false)
})

test('M2: malformed monetary values and unresolved counts never produce a savings claim', () => {
  const malformed = [
    [Number.NaN, 35, 0],
    [Number.MAX_SAFE_INTEGER + 1, 35, 0],
    [-1, 35, 0],
    [500, 35.001, 0],
    [500, Number.POSITIVE_INFINITY, 0],
    [500, -1, 0],
    [500, 35, -1],
    [500, 35, 0.5],
    [500, 35, Number.NaN],
    ['500', 35, 0],
    [null, 35, 0],
  ]

  for (const [cents, budget, unresolved] of malformed) {
    assert.deepEqual(assessPlannerBudgetCents(cents, budget, unresolved), {
      status: 'unknown',
      reason: 'invalid-input',
      budgetCents: null,
      knownMinimumCents: null,
      unresolvedLineCount: null,
    })
  }
})

test('M2: safe integer-cent boundary is not rounded through floating-point euros', () => {
  const assessment = assessPlannerBudgetCents(Number.MAX_SAFE_INTEGER, 0, 0)
  assert.equal(assessment.status, 'known')
  assert.equal(assessment.remainingCents, -Number.MAX_SAFE_INTEGER)
  assert.equal(
    assessment.remainingLabel,
    euro.formatCents(-Number.MAX_SAFE_INTEGER),
  )
  assert.notEqual(assessment.remainingLabel, '—')
})

test('M2: cent-exact non-integer euro budget is supported without sub-cent coercion', () => {
  const result = assessPlannerBudgetCents(15, 0.29, 0)
  assert.equal(result.status, 'known')
  assert.equal(result.remainingCents, 14)
  assert.equal(result.remainingLabel, euro.formatCents(14))
})
