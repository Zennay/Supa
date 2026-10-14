import assert from 'node:assert/strict'
import test from 'node:test'

import { plannerKnownMinimumOverrunCents } from '../src/features/planner/plannerKnownMinimumOverrun.ts'
import { euro } from '../src/lib/money.ts'

// Independent integer-cent comparison, not price observations or savings proof.
test('QA M3: known minimum overrun matches integer cents for 47,000+ incomplete basket boundaries', () => {
  let vectors = 0
  for (let cents = 1; cents <= 100_000; cents += 17) {
    const budgetEuros = cents / 100
    for (const missing of [1, 2, 11, 100]) {
      for (const offset of [-1, 0, 1, 101]) {
        const knownCostCents = cents + offset
        const actual = plannerKnownMinimumOverrunCents({
          knownCostCents,
          budgetEuros,
          unresolvedLineCount: missing,
        })
        const expected = offset > 0 ? offset : null
        assert.equal(actual, expected,
          `budget=${cents}c known=${knownCostCents}c missing=${missing}`)
        // A complete basket is not eligible for a "known minimum" warning.
        assert.equal(plannerKnownMinimumOverrunCents({
          knownCostCents,
          budgetEuros,
          unresolvedLineCount: 0,
        }), null)
        if (actual !== null) {
          const shown = euro.formatCents(actual)
          assert.ok(shown.includes(offset === 1 ? '0,01' : '1,01'),
            `localized eurocent warning must not drift: ${shown}`)
        }
        vectors++
      }
    }
  }
  assert.ok(vectors >= 90_000, 'Minimum-overrun cross-product must not shrink')
})

test('QA M3: malformed money and unknown counts never turn into confident minimum overrun', () => {
  const invalid = [
    { knownCostCents: -1, budgetEuros: 20, unresolvedLineCount: 1 },
    { knownCostCents: 100.1, budgetEuros: 20, unresolvedLineCount: 1 },
    { knownCostCents: Number.MAX_SAFE_INTEGER + 1, budgetEuros: 20, unresolvedLineCount: 1 },
    { knownCostCents: Number.NaN, budgetEuros: 20, unresolvedLineCount: 1 },
    { knownCostCents: 1000, budgetEuros: 0.001, unresolvedLineCount: 1 },
    { knownCostCents: 1000, budgetEuros: -1, unresolvedLineCount: 1 },
    { knownCostCents: 1000, budgetEuros: '10,00', unresolvedLineCount: 1 },
    { knownCostCents: 1000, budgetEuros: 9.99, unresolvedLineCount: 0 },
    { knownCostCents: 1000, budgetEuros: 9.99, unresolvedLineCount: 0.5 },
    { knownCostCents: 1000, budgetEuros: 9.99, unresolvedLineCount: Number.MAX_SAFE_INTEGER + 1 },
    { knownCostCents: 1000, budgetEuros: 9.99, unresolvedLineCount: -1 },
  ]
  for (const input of invalid) {
    assert.equal(plannerKnownMinimumOverrunCents(input), null, JSON.stringify(input))
  }
})
