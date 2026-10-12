import assert from 'node:assert/strict'
import test from 'node:test'

import { plannerBudgetStatusCopyNl } from '../src/lib/plannerBudgetStatusCopyNl.ts'
import { euro } from '../src/lib/money.ts'

test('product #1041: complete below/above/equal budgets retain cent-exact copy', () => {
  assert.deepEqual(plannerBudgetStatusCopyNl(1969, 35, 0), {
    text: `${euro.formatCents(1531)} over`,
    warning: false,
    certainty: 'exact',
  })
  assert.deepEqual(plannerBudgetStatusCopyNl(4001, 35, 0), {
    text: `${euro.formatCents(501)} boven budget`,
    warning: true,
    certainty: 'exact',
  })
  assert.deepEqual(plannerBudgetStatusCopyNl(3500, 35, 0), {
    text: `${euro.formatCents(0)} over`,
    warning: false,
    certainty: 'exact',
  })
})

test('product #1041: incomplete known minimum over budget is a lower-bound warning only', () => {
  assert.deepEqual(plannerBudgetStatusCopyNl(4001, 35, 2), {
    text: `Minimaal ${euro.formatCents(501)} boven budget · 2 mandregels open`,
    warning: true,
    certainty: 'known-minimum',
  })
  assert.deepEqual(plannerBudgetStatusCopyNl(3501, 35, 1), {
    text: `Minimaal ${euro.formatCents(1)} boven budget · 1 mandregel open`,
    warning: true,
    certainty: 'known-minimum',
  })
})

test('product #1041: unresolved non-overspend is NOT an under-budget claim', () => {
  for (const [cost, budget, count, expectedText] of [
    [1969, 35, 1, '1 mandregel open'],
    [3500, 35, 2, '2 mandregels open'],
    [0, 35, 11, '11 mandregels open'],
  ]) {
    assert.deepEqual(plannerBudgetStatusCopyNl(cost, budget, count), {
      text: expectedText,
      warning: true,
      certainty: 'known-minimum',
    })
  }
})

test('product #1041: loss of basket certainty retracts exact remainder on next assessment', () => {
  const exact = plannerBudgetStatusCopyNl(1969, 35, 0)
  const incomplete = plannerBudgetStatusCopyNl(1969, 35, 1)
  const repriced = plannerBudgetStatusCopyNl(4001, 35, 1)
  assert.equal(exact.certainty, 'exact')
  assert.equal(incomplete.text, '1 mandregel open')
  assert.equal(repriced.text, `Minimaal ${euro.formatCents(501)} boven budget · 1 mandregel open`)
  assert.doesNotMatch(incomplete.text + repriced.text, /\sover$/)
})

test('product #1041: malformed price, fractional cent or count never surfaces money', () => {
  for (const input of [
    [null, 35, 1],
    [NaN, 35, 1],
    [-1, 35, 1],
    [4001.5, 35, 1],
    [4001, 35.001, 1],
    [4001, 35, -1],
    [4001, 35, Number.POSITIVE_INFINITY],
    [Number.MAX_SAFE_INTEGER + 1, 35, 1],
    [4001, '35', 1],
  ]) {
    assert.deepEqual(plannerBudgetStatusCopyNl(...input), {
      text: 'Budget niet beschikbaar',
      warning: true,
      certainty: 'unavailable',
    })
  }
})

test('product #1041: zero-budget and one-cent custom budgets never claim savings', () => {
  assert.deepEqual(plannerBudgetStatusCopyNl(1, 0, 3), {
    text: `Minimaal ${euro.formatCents(1)} boven budget · 3 mandregels open`,
    warning: true,
    certainty: 'known-minimum',
  })
  assert.deepEqual(plannerBudgetStatusCopyNl(2, 0.01, 1), {
    text: `Minimaal ${euro.formatCents(1)} boven budget · 1 mandregel open`,
    warning: true,
    certainty: 'known-minimum',
  })
})
