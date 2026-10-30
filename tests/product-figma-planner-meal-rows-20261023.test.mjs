import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import { curatedFigmaRecipes } from '../src/features/recipes/curatedFigmaRecipes.ts'

test('Figma Planner 3359:4896 meal rows and total card keep real state and make no savings claim', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { PlannerView } = await vite.ssrLoadModule('/src/features/planner/PlannerView.tsx')
    const fried = curatedFigmaRecipes.find(recipe => recipe.id === 'supa-fried-rice')
    const recipes = [...m2Recipes, fried]
    const meals = m2InitialPlan.map((meal, index) => index === 0 ? { ...meal, recipeId: fried.id } : meal)
    const activeDays = meals.slice(0, -1).map(meal => meal.day)
    const inactiveDay = meals.at(-1).day
    const html = renderToStaticMarkup(createElement(PlannerView, {
      budget: 35,
      activeDays,
      plannedMeals: meals,
      recipes,
      basketTotalCents: null,
      basketUnresolvedLineCount: 0,
      onBudgetChange() {},
      onToggleDay() {},
      onRecipeChange() {},
      onReset() {},
    }))

    assert.equal((html.match(/class="meal-card meal-config hifi-meal-row active"/g) ?? []).length, activeDays.length)
    assert.equal((html.match(/Voeg nu iets toe aan de planner/g) ?? []).length, 1)
    assert.match(html, new RegExp(`aria-label="${inactiveDay} aan planning toevoegen"`))
    assert.doesNotMatch(html, new RegExp(`id="recipe-${inactiveDay}"`))
    for (const day of activeDays) assert.match(html, new RegExp(`id="recipe-${day}"`))
    // Only the curated SUPA recipe receives original Figma food photography.
    assert.equal((html.match(/<span class="hifi-meal-thumb" aria-hidden="true"><img /g) ?? []).length, 1)
    assert.match(html, /<strong class="hifi-total-label">Totaal<\/strong>/)
    assert.match(html, /Prijs onbekend/)
    assert.match(html, /<summary>Bekijk berekening<\/summary>/)
    assert.match(html, /id="weekbudget-title"/)
    // Week strip shows the same original photo for the planned curated day.
    assert.equal((html.match(/hifi-planner-day-number with-photo/g) ?? []).length, 1)
    // Overlap strip names shared ingredients and days, never an amount.
    const strip = html.match(/<p class="hifi-reuse-strip"[\s\S]*?<\/p>/)?.[0] ?? ''
    assert.match(strip, /in combinatie: /)
    assert.doesNotMatch(strip, /€|bespaar/i)
    // Figma primary action routes to the real shopping list.
    assert.match(html, /<button type="button" class="hifi-planner-list-cta">Voeg planning toe aan boodschappenlijst<\/button>/)
    assert.doesNotMatch(html, /Potentiele besparing|Potentiële besparing|Supavoordeel|bespaar tot/i)
  } finally {
    await vite.close()
  }
})
