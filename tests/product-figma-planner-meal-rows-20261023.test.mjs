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

    // Mobile-focused row adds a state class without replacing Figma row styling.
    assert.equal((html.match(/class="meal-card meal-config hifi-meal-row active(?: quick-focused)?"/g) ?? []).length, activeDays.length)
    assert.match(html, /class="hifi-meal-card quick-focused"/)
    assert.equal((html.match(/Voeg nu iets toe aan de planner/g) ?? []).length, 1)
    assert.match(html, new RegExp(`aria-label="${inactiveDay} aan planning toevoegen"`))
    assert.doesNotMatch(html, new RegExp(`id="recipe-${inactiveDay}"`))
    // Main now opens per-row editing on demand; mobile quick selection is immediate.
    for (const day of activeDays) assert.doesNotMatch(html, new RegExp(`id="recipe-${day}"`))
    // Only the curated SUPA recipe receives original Figma food photography.
    assert.equal((html.match(/<span class="hifi-meal-thumb" aria-hidden="true"><img /g) ?? []).length, 1)
    assert.match(html, /<strong class="hifi-total-label">Totaal<\/strong>/)
    assert.match(html, /class="hifi-total-amount"/)
    // Mobile budget shortcuts use the persisted budget and no unverified totals.
    // Mobile edits the real persisted weekday recipe without a second plan.
    assert.match(html, /aria-label="Recept voor de gekozen dag"/)
    assert.match(html, /id="planner-mobile-quick-recipe"/)
    assert.match(html, /Wijzig dit recept direct in je bestaande weekplanning/)
    const nothingActive = renderToStaticMarkup(createElement(PlannerView, {
      budget: 35, activeDays: [], plannedMeals: meals, recipes,
      basketTotalCents: null, basketUnresolvedLineCount: 0,
      onBudgetChange() {}, onToggleDay() {}, onRecipeChange() {}, onReset() {},
    }))
    assert.doesNotMatch(nothingActive, /id="planner-mobile-quick-recipe"/)
    assert.match(nothingActive, /alleen een dag kiezen verandert je planning niet/)
    assert.match(html, /aria-label="Snel weekbudget instellen"/)
    assert.match(html, /Weekbudget: /)
    assert.match(html, /Winkelkosten nog onbekend/)
    assert.match(html, /aria-controls="custom-weekbudget-form"[^>]*>Eigen bedrag instellen/)
    assert.equal((html.match(/class="planner-mobile-budget-options"/g) ?? []).length, 1)
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length >= 1, true)
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
    // With a complete user-owned basket, the mobile summary is exact.
    // With an unresolved line, only the provable minimum may be displayed.
    const withBasket = (cents, unresolved) => renderToStaticMarkup(createElement(PlannerView, {
      budget: 35, activeDays, plannedMeals: meals, recipes,
      ownSource: { store: 'PLUS', observedAt: '2026-10-29T12:00:00Z' },
      basketTotalCents: cents, basketUnresolvedLineCount: unresolved,
      onBudgetChange() {}, onToggleDay() {}, onRecipeChange() {}, onReset() {},
      onOpenShoppingList() {},
    }))
    assert.match(withBasket(2800, 0), /7,00 over/)
    const incomplete = withBasket(3600, 1)
    assert.match(incomplete, /overige prijzen onbekend/)
    assert.doesNotMatch(incomplete, /1,00 over<\/small>/)
  } finally {
    await vite.close()
  }
})
