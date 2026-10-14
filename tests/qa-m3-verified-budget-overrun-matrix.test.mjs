import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import { plannerKnownMinimumOverrunCents } from '../src/features/planner/plannerKnownMinimumOverrun.ts'

// Deliberately independent cent arithmetic, not the planner's own formatting
// or comparison helper. All amounts are synthetic example basket totals.
const COSTS = [0, 1, 2999, 3000, 3499, 3500, 3501, 3502, 3999, 4000, 4001, 9999]
const BUDGETS = [0, 1, 2999, 3000, 3499, 3500, 3501, 4000, 4001]
const PENDING = [1, 2, 11]
function rawValue(cents) {
  return (Math.trunc(cents / 100)) + ',' + String(cents % 100).padStart(2, '0')
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test('324 exact-cent comparison cases never invent a lower bound without incomplete verified inputs', () => {
  let count = 0
  for (const cost of COSTS) {
    for (const budgetCents of BUDGETS) {
      for (const unresolvedLineCount of PENDING) {
        const expected = cost > budgetCents ? cost - budgetCents : null
        const actual = plannerKnownMinimumOverrunCents({
          knownCostCents: cost,
          budgetEuros: budgetCents / 100,
          unresolvedLineCount,
        })
        assert.equal(actual, expected,
          'exact cent lower bound for ' + cost + '/' + budgetCents + '/' + unresolvedLineCount)
        count++
      }
    }
  }
  assert.equal(count, 324)

  const max = Number.MAX_SAFE_INTEGER
  for (const cost of [max, max - 1, 4001]) {
    assert.equal(plannerKnownMinimumOverrunCents({
      knownCostCents: cost, budgetEuros: 0, unresolvedLineCount: 1,
    }), cost, 'safe-integer cents do not become float currency')
  }
  for (const bad of [null, undefined, {}, [], '100', NaN, Infinity, -1, 1.5, max + 1]) {
    assert.equal(plannerKnownMinimumOverrunCents({
      knownCostCents: bad, budgetEuros: 35, unresolvedLineCount: 1,
    }), null)
  }
  for (const bad of [null, undefined, {}, [], '35', NaN, Infinity, -1, 35.001, max]) {
    assert.equal(plannerKnownMinimumOverrunCents({
      knownCostCents: 4001, budgetEuros: bad, unresolvedLineCount: 1,
    }), null)
  }
  for (const bad of [0, -1, 1.5, NaN, Infinity, '1', null, undefined]) {
    assert.equal(plannerKnownMinimumOverrunCents({
      knownCostCents: 4001, budgetEuros: 35, unresolvedLineCount: bad,
    }), null)
  }
})

test('actual Planner SSR: every incomplete basket reports only the proven cents or unresolved uncertainty', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { PlannerView } = await vite.ssrLoadModule('/src/features/planner/PlannerView.tsx')
    const render = (cost, budget, unresolved) =>
      renderToStaticMarkup(createElement(PlannerView, {
        budget,
        activeDays: m2DefaultActiveDays,
        plannedMeals: m2InitialPlan,
        recipes: m2Recipes,
        basketTotalCents: cost,
        basketUnresolvedLineCount: unresolved,
        onBudgetChange() {}, onToggleDay() {}, onRecipeChange() {}, onReset() {},
      }))
    let checked = 0
    for (const budgetCents of [0, 2999, 3500, 3501, 4000, 4001]) {
      for (const cost of [0, 1, 3499, 3500, 3501, 3502, 4000, 4001, 9999]) {
        for (const pending of [1, 2, 11]) {
          const html = render(cost, budgetCents / 100, pending)
          const spoken = html.match(/<span class="budget-status[^"]*" aria-live="polite">([^<]*)<\/span>/)?.[1]
          assert.ok(spoken, 'actual accessible budget status is rendered')
          assert.match(html, /min\./, 'unfinished basket must announce only known minimum')
          assert.doesNotMatch(html, /exacte besparing|besparing bewezen/i)
          if (cost > budgetCents) {
            const minimum = rawValue(cost - budgetCents)
            assert.match(spoken, new RegExp('^Minimaal.*' + escapeRegExp(minimum) + '.*boven budget'))
            assert.match(html, /Het uiteindelijke tekort kan groter zijn\./)
            assert.match(html, /bekende kosten liggen al minimaal/)
          } else {
            assert.doesNotMatch(spoken, /Minimaal|boven budget/)
            assert.match(spoken, new RegExp('^' + pending + ' mandregel'))
            assert.match(html, /nog niet bepalen of je binnen of boven budget zit/)
          }
          assert.match(html, /Bekend minimum van het weekbudget/)
          checked++
        }
      }
    }
    assert.equal(checked, 162)

    // A complete basket can say exactly above/below, and a 1-cent difference
    // may never be formatted as a dash or treated as an unproven claim.
    for (const [cost, expected, over] of [
      [3499, '0,01', false],
      [3500, '0,00', false],
      [3501, '0,01', true],
      [4001, '5,01', true],
    ]) {
      const html = render(cost, 35, 0)
      const spoken = html.match(/<span class="budget-status[^"]*" aria-live="polite">([^<]*)<\/span>/)?.[1]
      assert.ok(spoken)
      assert.ok(spoken.includes(expected), 'one-cent exact output: ' + expected)
      assert.match(spoken, over ? /boven budget/ : /over/)
      assert.doesNotMatch(spoken, /Minimaal|Budgetgegevens controleren|—/)
    }
  } finally {
    await vite.close()
  }
})
