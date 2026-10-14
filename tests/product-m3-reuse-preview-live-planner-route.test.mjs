import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'

test('real current Planner routes optional non-destructive ingredient reuse preview', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { PlannerView } = await vite.ssrLoadModule('/src/features/planner/PlannerView.tsx')
    const base = {
      budget: 27.5, activeDays: m2DefaultActiveDays,
      plannedMeals: m2InitialPlan, recipes: m2Recipes,
      basketTotalCents: 1969, basketUnresolvedLineCount: 0,
      onBudgetChange() { assert.fail('SSR may not update budget') },
      onToggleDay() { assert.fail('SSR may not toggle day') },
      onRecipeChange() { assert.fail('Preview must not silently change the plan') },
      onReset() { assert.fail('SSR may not reset the plan') },
    }
    const render = props => renderToStaticMarkup(createElement(PlannerView, props))
    const html = render(base)
    assert.match(html, /aria-label="Ingrediënten opnieuw gebruiken"/)
    assert.match(html, /aria-label="Een ander recept bekijken"/)
    assert.match(html, /Bekijk een ander recept zonder te wijzigen/)
    assert.match(html, /aria-expanded="false"/)
    assert.doesNotMatch(html, /Kies .* voor Ma|aria-label="Voorbeeld van gedeelde ingrediënten"/)
    assert.match(html, /Eigen budget/)
    const noIngredients = render({ ...base,
      recipes: m2Recipes.map(({ ingredients, ...recipe }) => recipe),
    })
    assert.doesNotMatch(noIngredients, /Een ander recept bekijken|Ingrediënten opnieuw gebruiken/)
    const empty = render({ ...base, activeDays: [] })
    assert.doesNotMatch(empty, /Een ander recept bekijken/)
  } finally {
    await vite.close()
  }
})
