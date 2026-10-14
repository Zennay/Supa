import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import { plannerKnownMinimumOverrunCents } from '../src/features/planner/plannerKnownMinimumOverrun.ts'

test('unfinished basket exposes only an exact-cent proven minimum overrun', () => {
  const assess = (knownCostCents, budgetEuros, unresolvedLineCount) =>
    plannerKnownMinimumOverrunCents({ knownCostCents, budgetEuros, unresolvedLineCount })

  assert.equal(assess(4001, 35, 2), 501)
  assert.equal(assess(3501, 35, 1), 1)
  assert.equal(assess(3500, 35, 1), null)
  assert.equal(assess(3300, 35, 1), null)
  assert.equal(assess(9007199254740991, 35, 1), 9007199254737491)
  for (const value of [null, undefined, NaN, Infinity, -1, 4001.5, 2 ** 54, '4001']) {
    assert.equal(assess(value, 35, 2), null)
  }
  for (const budget of [null, undefined, NaN, Infinity, -1, 35.001, 1e25, '35']) {
    assert.equal(assess(4001, budget, 2), null)
  }
  for (const pending of [0, -1, 1.5, Infinity, NaN, null]) {
    assert.equal(assess(4001, 35, pending), null,
      'not-an-incomplete-basket cannot be used as a lower-bound proof')
  }
})

test('actual Planner says minimaal when the known basket alone exceeds a weekly budget', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { PlannerView } = await vite.ssrLoadModule(
      '/src/features/planner/PlannerView.tsx',
    )
    const render = (total, unresolved) => renderToStaticMarkup(createElement(PlannerView, {
      budget: 35,
      activeDays: m2DefaultActiveDays,
      plannedMeals: m2InitialPlan,
      recipes: m2Recipes,
      basketTotalCents: total,
      basketUnresolvedLineCount: unresolved,
      onBudgetChange() {},
      onToggleDay() {},
      onRecipeChange() {},
      onReset() {},
    }))
    const minimum = render(4001, 2)
    assert.match(minimum, /Minimaal[^<]*5,01[^<]*boven budget[^<]*2 mandregels open/)
    assert.match(minimum, /bekende kosten liggen al minimaal[^<]*5,01[^<]*boven je budget/)
    assert.match(minimum, /uiteindelijke tekort kan groter zijn/)
    assert.match(minimum, /min\.[^<]*40,01/)
    assert.doesNotMatch(minimum, /Besparing bewezen|€[^<]*exacte besparing/i)

    const uncertain = render(3400, 1)
    assert.match(uncertain, /1 mandregel open/)
    assert.match(uncertain, /nog niet bepalen of je binnen of boven budget zit/)
    assert.doesNotMatch(uncertain, /Minimaal[^<]*boven budget/)

    const exact = render(4001, 0)
    assert.match(exact, /5,01[^<]*boven budget/)
    assert.doesNotMatch(exact, /Minimaal[^<]*boven budget/)
  } finally {
    await vite.close()
  }
})
