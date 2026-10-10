import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import { buildIngredientReuseInsight } from '../src/domain/ingredientReuse.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { euro } from '../src/lib/money.ts'
import { RecipeEstimateDisclosure } from '../src/features/planner/RecipeEstimateDisclosure.ts'

const require = createRequire(import.meta.url)
const jsx = require('react/jsx-runtime')

function compiledSource(path, filename, cssFile) {
  const original = readFileSync(new URL(path, import.meta.url), 'utf8')
  const source = original.replace(new RegExp('^import\\s+[\\x27\\x22]\\./' + cssFile.replaceAll('.', '\\.') + '[\\x27\\x22]\\s*;?\\s*$', 'm'), '')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
    reportDiagnostics: true,
  })
  assert.deepEqual(compiled.diagnostics, [])
  return compiled.outputText
}

function fromCommonJs(code, imports) {
  const module = { exports: {} }
  new Function('module', 'exports', 'require', code)(
    module, module.exports, (name) => {
      if (name === 'react/jsx-runtime') return jsx
      assert.ok(Object.hasOwn(imports, name), 'Unexpected component dependency: ' + name)
      return imports[name]
    },
  )
  return module.exports
}

// Both the planner and its reuse card are ACTUAL production TSX components;
// CSS is suppressed only because Node SSR does not load Vite style imports.
const cardModule = fromCommonJs(
  compiledSource('../src/features/planner/IngredientReuseCard.tsx', 'IngredientReuseCard.tsx', 'ingredient-reuse.css'),
  {},
)
const plannerModule = fromCommonJs(
  compiledSource('../src/features/planner/PlannerView.tsx', 'PlannerView.tsx', 'planner.css'),
  {
    '../../lib/money': { euro },
    '../../lib/plannerBudgetCents.ts': { assessPlannerBudgetCents },
    '../../domain/ingredientReuse.ts': { buildIngredientReuseInsight },
    './RecipeEstimateDisclosure.ts': { RecipeEstimateDisclosure },
    './IngredientReuseCard.tsx': { IngredientReuseCard: cardModule.IngredientReuseCard },
    './RecipeReusePreviewPanel.tsx': { RecipeReusePreviewPanel: () => null },
  },
)

function renderPlanner({
  plannedMeals = m2InitialPlan,
  activeDays = m2DefaultActiveDays,
  recipes = m2Recipes,
} = {}) {
  return renderToStaticMarkup(React.createElement(plannerModule.PlannerView, {
    budget: 35,
    plannedMeals,
    activeDays,
    recipes,
    basketTotalCents: 1969,
    basketUnresolvedLineCount: 0,
    onBudgetChange() {},
    onToggleDay() {},
    onRecipeChange() {},
    onReset() {},
  }))
}

test('real planner renders current chosen-week shared ingredients with no money inference', () => {
  const html = renderPlanner()
  assert.match(html, /aria-label="Ingrediënten opnieuw gebruiken"/)
  assert.match(html, /Handig gecombineerd/)
  assert.match(html, /Basmati rijst/)
  assert.match(html, /3 maaltijden/)
  assert.match(html, /Kippendij/)
  assert.match(html, /bewijst[\s\S]*geen restjes, minder verpakkingen of financiële besparing/)
  assert.match(html, /aria-label="Kies je weekbudget"/)
  assert.match(html, /Richtprijzen zijn indicatief/)
})

test('real planner recalculates shared ingredients for changed active days and recipe choice', () => {
  const baseline = renderPlanner({ activeDays: ['Ma', 'Di'] })
  assert.match(baseline, /Basmati rijst/)
  assert.match(baseline, /2 maaltijden/)

  const changedPlan = m2InitialPlan.map(meal =>
    meal.day === 'Di' ? { ...meal, recipeId: 'pasta' } : meal)
  const changed = renderPlanner({ plannedMeals: changedPlan, activeDays: ['Ma', 'Di'] })
  assert.match(changed, /komen nog geen ingrediënten meerdere dagen terug/)
  assert.doesNotMatch(changed, /<li[^>]*>[^<]*Basmati rijst/)
  assert.notEqual(changed, baseline)

  const single = renderPlanner({ activeDays: ['Wo'] })
  assert.match(single, /komen nog geen ingrediënten meerdere dagen terug/)
  assert.doesNotMatch(single, /3 maaltijden/)
})

test('real planner hides confident reuse when ingredient definitions are missing', () => {
  const stripped = m2Recipes.map(({ ingredients, ...recipe }) => recipe)
  const html = renderPlanner({ recipes: stripped })
  assert.doesNotMatch(html, /Handig gecombineerd|Ingrediënten opnieuw gebruiken/)
  assert.match(html, /Richtprijzen zijn indicatief/)
})

test('real planner fails closed on invalid duplicated active-day identity', () => {
  const html = renderPlanner({ activeDays: ['Ma', 'Ma'] })
  assert.match(html, /Maak eerst een geldige planning/)
  assert.doesNotMatch(html, /<ul class="ingredient-reuse-list"/)
  assert.match(html, /Plan eerst. Vergelijk daarna./)
})
