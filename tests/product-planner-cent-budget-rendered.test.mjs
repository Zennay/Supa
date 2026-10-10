import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

import { euro } from '../src/lib/money.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { RecipeEstimateDisclosure } from '../src/features/planner/RecipeEstimateDisclosure.ts'
import { m2Recipes } from '../src/data/m2Fixture.ts'

// SSR the actual PlannerView, not a reimplementation of its budget label.
const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../src/features/planner/PlannerView.tsx', import.meta.url), 'utf8')
const script = source.replace(/^import\s+['"]\.\/planner\.css['"]\s*;?\s*$/m, '')
const compiled = ts.transpileModule(script, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'PlannerView.tsx',
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])

const pageModule = { exports: {} }
const localRequire = (moduleName) => {
  if (moduleName === '../../lib/plannerBudgetCents.ts') return { assessPlannerBudgetCents }
  if (moduleName === '../../lib/money') return { euro }
  if (moduleName === './RecipeEstimateDisclosure.ts') return { RecipeEstimateDisclosure }
  // Product-core ingredient overlap is covered through actual SSR separately;
  // these prior fixture-budget tests remain focused on money and estimate copy.
  if (moduleName === '../../domain/ingredientReuse.ts') return { buildIngredientReuseInsight: () => null }
  if (moduleName === './IngredientReuseCard.tsx') return { IngredientReuseCard: () => null }
  if (moduleName === 'react/jsx-runtime') return require(moduleName)
  throw new Error(`Unexpected PlannerView dependency: ${moduleName}`)
}
new Function('module', 'exports', 'require', compiled.outputText)(
  pageModule, pageModule.exports, localRequire,
)
const { PlannerView } = pageModule.exports

function renderBudget(basketTotalCents, basketUnresolvedLineCount, budget = 35, plannedMeals = [], recipes = []) {
  const html = renderToStaticMarkup(React.createElement(PlannerView, {
    budget,
    activeDays: plannedMeals.map((meal) => meal.day),
    plannedMeals,
    recipes,
    basketTotalCents,
    basketUnresolvedLineCount,
    onBudgetChange() {},
    onToggleDay() {},
    onRecipeChange() {},
    onReset() {},
  }))
  const status = html.match(/class="budget-status(?: warning)?" aria-live="polite">([^<]+)<\/span>/)
  assert.ok(status, 'Planner should render a readable, live budget status')
  return { html, status: status[1].replaceAll('\u00a0', ' ') }
}

test('product #1041: real PlannerView SSR shows the exact €15,31 remainder for €35 − €19,69', () => {
  const { html, status } = renderBudget(1969, 0)
  assert.match(status, /15,31 over/)
  assert.doesNotMatch(status, /—|NaN|Infinity/)
  assert.match(html, /aria-label="Kies je weekbudget"/)
  assert.match(html, /aria-label="Geplande maaltijden"/)
})

test('product #1041: SSR distinguishes overspend, exact budget and sub-euro margins', () => {
  assert.match(renderBudget(4001, 0).status, /5,01 boven budget/)
  assert.match(renderBudget(3500, 0).status, /0,00 over/)
  assert.match(renderBudget(15, 0, 0.29).status, /0,14 over/)
})

test('product #1041: unresolved basket exposes known minimum without a false remainder', () => {
  const { html, status } = renderBudget(1969, 1)
  assert.match(status, /1 mandregel open/)
  assert.doesNotMatch(status, /15,31|boven budget/)
  assert.match(html.replaceAll('\u00a0', ' '), /min\. [^<]*19,69/)
  assert.match(html, /alleen het bekende minimum/)
})

test('product #1041: malformed basket money fails closed in the rendered planner', () => {
  const { html, status } = renderBudget(Number.NaN, 0)
  assert.equal(status, 'Budgetgegevens controleren')
  assert.match(html, /mandgegevens zijn niet geldig/)
  assert.doesNotMatch(html, /NaN|Infinity|15,31 over|binnen budget zit/)
  assert.match(html, /aria-valuenow="0"/)
})

test('product #1041: true sub-cent budget is not silently rounded for a claim', () => {
  const { html, status } = renderBudget(1969, 0, 35.001)
  assert.equal(status, 'Budgetgegevens controleren')
  assert.doesNotMatch(html, /15,31 over/)
  assert.equal(euro.format(35.001), '—')
})

test('product #709: the real planner marks fixture recipe amounts as indicative, never as a current quote', () => {
  const recipe = m2Recipes[0]
  const plannedMeals = [{ day: 'Di', recipeId: recipe.id }]
  const { html } = renderBudget(1969, 0, 35, plannedMeals, m2Recipes)

  assert.match(html, /data-recipe-cost-kind="indicative"/)
  assert.match(html, /role="note"/)
  assert.match(html, /aria-label="Richtprijs:/)
  assert.match(html, />Richtprijs:.*\/ recept<\/small>/)
  assert.match(html, /data-recipe-estimate-explanation/)
  assert.match(html, /Richtprijzen zijn indicatief/)
  assert.doesNotMatch(html, /<small>[^<]*€[^<]*\/ recept<\/small>/)
  assert.match(html, /aria-label="Recept voor Di"/)
})

test('product #709: an invalid recipe fixture estimate remains unknown in actual rendered planner', () => {
  const bad = { ...m2Recipes[0], estimatedCost: Number.NaN }
  const { html } = renderBudget(1969, 0, 35, [{ day: 'Di', recipeId: bad.id }], [bad])

  assert.match(html, /data-recipe-cost-kind="unknown"/)
  assert.match(html, /Richtprijs onbekend/)
  assert.doesNotMatch(html, /€NaN|€Infinity|Richtprijs: €/)
  assert.match(html, /aria-label="Recept voor Di"/)
})
