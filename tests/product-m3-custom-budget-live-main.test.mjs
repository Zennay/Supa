import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { m2InitialPlan, m2Recipes, m2DefaultActiveDays } from '../src/data/m2Fixture.ts'
import { restorePlannerPreferencesWithCustomBudget, parseCustomWeekBudgetCents } from '../src/features/planner/customWeekBudget.ts'

const recipeIds = m2Recipes.map(recipe => recipe.id)
test('custom budget restores only exact cents and does not override canonical planner checks', () => {
  assert.equal(parseCustomWeekBudgetCents('27,50'), 2750)
  assert.equal(parseCustomWeekBudgetCents('42.75'), 4275)
  assert.equal(parseCustomWeekBudgetCents('0,01'), 1)
  assert.equal(parseCustomWeekBudgetCents('1000,00'), 100000)
  for (const invalid of ['27,501', '27,', '1.000,00', '0', '1000,01', '1e2', '-1', '', '0002']) {
    assert.equal(parseCustomWeekBudgetCents(invalid), null)
  }
  const baseline = restorePlannerPreferencesWithCustomBudget(null, m2InitialPlan, recipeIds)
  const raw = JSON.stringify({ ...baseline, budget: 27.5 })
  const restored = restorePlannerPreferencesWithCustomBudget(raw, m2InitialPlan, recipeIds)
  assert.equal(restored.budget, 27.5)
  assert.deepEqual(restored.activeDays, baseline.activeDays)
  assert.deepEqual(restored.recipeByDay, baseline.recipeByDay)
  const unsafe = restorePlannerPreferencesWithCustomBudget(
    JSON.stringify({ ...baseline, budget: 27.501 }), m2InitialPlan, recipeIds)
  assert.notEqual(unsafe.budget, 27.501)
})

test('real Planner displays custom amount affordance while retaining exact-cent status and privacy', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { PlannerView } = await vite.ssrLoadModule('/src/features/planner/PlannerView.tsx')
    const props = {
      budget: 27.5,
      activeDays: m2DefaultActiveDays,
      plannedMeals: m2InitialPlan,
      recipes: m2Recipes,
      basketTotalCents: 1969,
      basketUnresolvedLineCount: 0,
      onBudgetChange() { assert.fail('SSR must never change a budget') },
      onToggleDay() {},
      onRecipeChange() {},
      onReset() {},
    }
    const html = renderToStaticMarkup(createElement(PlannerView, props))
    assert.match(html, /Eigen budget/)
    assert.match(html, /27,50/)
    assert.match(html, /Ander bedrag instellen|Eigen budget/)
    assert.match(html, /7,81[^<]*over/)
    assert.match(html, /aria-expanded="false"/)
    assert.doesNotMatch(html, /<form|Budget opslaan|navigator\.clipboard/)
    const unknown = renderToStaticMarkup(createElement(PlannerView, {
      ...props, basketTotalCents: 2801, basketUnresolvedLineCount: 2,
    }))
    assert.match(unknown, /Minimaal[^<]*0,51[^<]*boven budget/)
    assert.match(unknown, /2 mandregels open/)
    assert.doesNotMatch(unknown, /besparing bewezen/i)
  } finally {
    await vite.close()
  }
})
