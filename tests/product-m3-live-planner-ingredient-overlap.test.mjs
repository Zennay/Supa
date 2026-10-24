import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'

test('live M3 planner explains actual current-week ingredient reuse without claiming savings', async () => {
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
    const render = ({
      meals = m2InitialPlan,
      days = m2DefaultActiveDays,
      recipes = m2Recipes,
    } = {}) => renderToStaticMarkup(createElement(PlannerView, {
      budget: 35,
      activeDays: days,
      plannedMeals: meals,
      recipes,
      basketTotalCents: 1969,
      basketUnresolvedLineCount: 0,
      onBudgetChange() {},
      onToggleDay() {},
      onRecipeChange() {},
      onReset() {},
    }))
    const strip = html => html.match(/<p class="hifi-reuse-strip"[\s\S]*?<\/p>/)?.[0] ?? ''
    const initial = render()
    assert.match(strip(initial), /Basmati rijst/)
    assert.match(initial, /Geplande maaltijden/)
    assert.doesNotMatch(initial, /aangetoonde besparing|Besparing bewezen|Bespaart/i)

    const changed = render({ days: ['Ma', 'Di'],
      meals: m2InitialPlan.map(meal =>
        meal.day === 'Di' ? { ...meal, recipeId: 'pasta' } : meal),
    })
    assert.equal(strip(changed), '')
    assert.notEqual(changed, initial)

    const untrusted = render({
      recipes: m2Recipes.map(({ ingredients, ...recipe }) => recipe),
    })
    assert.equal(strip(untrusted), '')
    assert.match(untrusted, /Geplande maaltijden/)

    const duplicate = render({ days: ['Ma', 'Ma'] })
    assert.equal(strip(duplicate), '')
  } finally {
    await vite.close()
  }
})
