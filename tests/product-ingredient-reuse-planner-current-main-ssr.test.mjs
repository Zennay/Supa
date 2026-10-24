import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'

// SSR the actual current-main PlannerView through Vite, so newer Planner
// dependencies cannot silently turn this into a stale mock-component test.
test('live planner explains overlap from current days and selected recipes, never a saving', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { PlannerView } = await vite.ssrLoadModule('/src/features/planner/PlannerView.tsx')
    const render = ({ plannedMeals = m2InitialPlan, activeDays = m2DefaultActiveDays, recipes = m2Recipes } = {}) =>
      renderToStaticMarkup(createElement(PlannerView, {
        budget: 35,
        activeDays,
        plannedMeals,
        recipes,
        basketTotalCents: 1969,
        basketUnresolvedLineCount: 0,
        onBudgetChange() {},
        onToggleDay() {},
        onRecipeChange() {},
        onReset() {},
      }))

    // Figma overlap strip between week card and rows: names the shared
    // ingredients and days of the current plan, never an amount or saving.
    const strip = html => html.match(/<p class="hifi-reuse-strip"[\s\S]*?<\/p>/)?.[0] ?? ''
    const baseline = render()
    assert.match(strip(baseline), /in combinatie: /)
    assert.match(strip(baseline), /Basmati rijst/)
    assert.doesNotMatch(strip(baseline), /€|bespaar|besparing/i)

    const alteredPlan = m2InitialPlan.map((meal) =>
      meal.day === 'Di' ? { ...meal, recipeId: 'pasta' } : meal)
    const changed = render({ plannedMeals: alteredPlan, activeDays: ['Ma', 'Di'] })
    assert.equal(strip(changed), '')
    assert.notEqual(changed, baseline)

    const onlyOneDay = render({ activeDays: ['Wo'] })
    assert.equal(strip(onlyOneDay), '')
    const missingIngredients = render({ recipes: m2Recipes.map(({ ingredients, ...recipe }) => recipe) })
    assert.equal(strip(missingIngredients), '')
  } finally {
    await vite.close()
  }
})
