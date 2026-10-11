import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  customWeekBudgetLabel,
  parseCustomWeekBudget,
  parsePlannerPreferencesWithCustomBudget,
} from '../src/domain/customPlannerBudget.ts'
import { serializePlannerPreferences } from '../src/domain/plannerPreferences.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { euro } from '../src/lib/money.ts'
import { RecipeEstimateDisclosure } from '../src/features/planner/RecipeEstimateDisclosure.ts'
import {
  m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'

// PRODUCT #1424: render the actual PlannerView against basket builder output,
// rather than manually supplying attractive fixture totals. These products
// are synthetic examples, never retailer observations or saving claims.
const require = createRequire(import.meta.url)
const domainBudget = { customWeekBudgetLabel, parseCustomWeekBudget }

function loadTsx(filename, dependencies) {
  const source = readFileSync(new URL(filename, import.meta.url), 'utf8')
    .replace(/^import\s+['"]\.\/[^'"]+\.css['"]\s*;?\s*$/gm, '')
  const compiled = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  })
  assert.deepEqual(compiled.diagnostics, [])
  const result = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    result, result.exports, (specifier) => {
      if (specifier === 'react') return React
      if (specifier === 'react/jsx-runtime') return require(specifier)
      if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier]
      throw new Error(`Unreviewed TSX runtime import: ${specifier}`)
    },
  )
  return result.exports
}

const { CustomBudgetInput } = loadTsx(
  '../src/features/planner/CustomBudgetInput.tsx',
  { '../../domain/customPlannerBudget.ts': domainBudget },
)
const { PlannerView } = loadTsx(
  '../src/features/planner/PlannerView.tsx',
  {
    '../../lib/plannerBudgetCents.ts': { assessPlannerBudgetCents },
    '../../lib/money': { euro },
    './RecipeEstimateDisclosure.ts': { RecipeEstimateDisclosure },
    './CustomBudgetInput.tsx': { CustomBudgetInput },
  },
)

const recipeIds = m2Recipes.map((recipe) => recipe.id)

function restore(budget, activeDays) {
  const initial = {
    budget,
    activeDays,
    recipeByDay: Object.fromEntries(m2InitialPlan.map(({ day, recipeId }) => [day, recipeId])),
  }
  return parsePlannerPreferencesWithCustomBudget(
    serializePlannerPreferences(initial),
    m2InitialPlan, recipeIds,
  )
}

function renderSelected(preferences, products = m2Products) {
  const plannedMeals = m2InitialPlan.map((meal) => ({
    ...meal, recipeId: preferences.recipeByDay[meal.day],
  }))
  const basket = buildOneStoreBasket({
    store: m2Store, products, plan: plannedMeals,
    activeDays: preferences.activeDays, recipes: m2Recipes,
  })
  const html = renderToStaticMarkup(React.createElement(PlannerView, {
    budget: preferences.budget,
    activeDays: preferences.activeDays,
    plannedMeals,
    recipes: m2Recipes,
    basketTotalCents: basket.totalCents,
    basketUnresolvedLineCount: basket.unresolvedLineCount,
    onBudgetChange() {}, onToggleDay() {}, onRecipeChange() {}, onReset() {},
  })).replaceAll('\u00a0', ' ')

  return { basket, html }
}

test('product #1424: actual pasta basket and custom budget render matching cent-exact remaining money', () => {
  const preferences = restore(27.5, ['Wo'])
  const { basket, html } = renderSelected(preferences)
  assert.equal(basket.unresolvedLineCount, 0)
  assert.ok(basket.totalCents > 0)
  const assessment = assessPlannerBudgetCents(basket.totalCents, preferences.budget, 0)
  assert.equal(assessment.status, 'known')
  const remaining = Math.abs(assessment.remainingCents)
  const suffix = assessment.overBudget ? 'boven budget' : 'over'

  assert.match(html, /value="27,50"/)
  assert.match(html, /Eigen weekbudget/)
  assert.ok(html.includes(`${euro.formatCents(remaining).replaceAll('\u00a0', ' ')} ${suffix}`))
  assert.ok(html.includes(euro.formatCents(basket.totalCents).replaceAll('\u00a0', ' ')))
  assert.match(html, /aria-label="Gepland deel van het weekbudget"/)
  assert.match(html, /data-recipe-estimate-explanation/)
  assert.doesNotMatch(html, /NaN|Infinity|Besparing:/)
})

test('product #1424: real incomplete chicken basket never renders a false over/under-budget conclusion', () => {
  const preferences = restore(0.01, ['Ma'])
  const { basket, html } = renderSelected(preferences)
  assert.ok(basket.unresolvedLineCount > 0)
  const assessed = assessPlannerBudgetCents(
    basket.totalCents, preferences.budget, basket.unresolvedLineCount,
  )
  assert.equal(assessed.status, 'unknown')
  assert.equal(assessed.reason, 'unresolved-products')

  assert.match(html, /value="0,01"/)
  assert.match(html, /aria-label="Bekend minimum van het weekbudget"/)
  assert.match(html, /alleen het bekende minimum/)
  assert.match(html, /productmatch/)
  assert.ok(html.includes(`min. ${euro.formatCents(basket.totalCents).replaceAll('\u00a0', ' ')}`))
  assert.doesNotMatch(html, /(?:\d+,\d{2} over|\d+,\d{2} boven budget)/)
})

test('product #1424: a price-only update crosses exact budget in the rendered real planner', () => {
  const preliminary = renderSelected(restore(35, ['Wo']))
  assert.equal(preliminary.basket.unresolvedLineCount, 0)
  const budget = parseCustomWeekBudget(customWeekBudgetLabel(preliminary.basket.totalCents / 100))
  assert.notEqual(budget, null)
  const preferences = restore(budget, ['Wo'])
  const original = renderSelected(preferences)
  assert.equal(original.basket.totalCents, preliminary.basket.totalCents)
  assert.match(original.html, /0,00 over/)

  const line = original.basket.lines.find((candidate) => candidate.status === 'matched')
  assert.ok(line)
  const newProducts = m2Products.map((product) =>
    product.id === line.productId
      ? { ...product, priceCents: product.priceCents + 1 }
      : product,
  )
  const changed = renderSelected(preferences, newProducts)
  const newSpent = changed.basket.totalCents
  assert.equal(newSpent, original.basket.totalCents + line.packs)
  assert.ok(
    changed.html.includes(
      `${euro.formatCents(line.packs).replaceAll('\u00a0', ' ')} boven budget`,
    ),
  )
  assert.ok(changed.html.includes(`value="${customWeekBudgetLabel(budget)}"`))
  assert.match(original.html, /0,00 over/, 'old render remains complete and unmodified')
})
