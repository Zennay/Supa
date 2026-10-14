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

    const baseline = render()
    assert.match(baseline, /aria-label="Ingrediënten opnieuw gebruiken"/)
    assert.match(baseline, /Handig gecombineerd/)
    assert.match(baseline, /Basmati rijst/)
    assert.match(baseline, /3 maaltijden/)
    assert.match(baseline, /Het bewijst[^<]*geen restjes, minder verpakkingen of financiële besparing/)
    assert.match(baseline, /Ander bedrag instellen/)

    const alteredPlan = m2InitialPlan.map((meal) =>
      meal.day === 'Di' ? { ...meal, recipeId: 'pasta' } : meal)
    const changed = render({ plannedMeals: alteredPlan, activeDays: ['Ma', 'Di'] })
    assert.match(changed, /komen nog geen ingrediënten meerdere dagen terug/)
    assert.doesNotMatch(changed, /3 maaltijden · Ma, Di/)
    assert.notEqual(changed, baseline)

    const onlyOneDay = render({ activeDays: ['Wo'] })
    assert.match(onlyOneDay, /komen nog geen ingrediënten meerdere dagen terug/)
    const missingIngredients = render({ recipes: m2Recipes.map(({ ingredients, ...recipe }) => recipe) })
    assert.doesNotMatch(missingIngredients, /aria-label="Ingrediënten opnieuw gebruiken"/)
    assert.doesNotMatch(missingIngredients, /Handig gecombineerd/)
  } finally {
    await vite.close()
  }
})
