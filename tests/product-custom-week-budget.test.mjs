import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

import {
  customWeekBudgetLabel,
  MAX_CUSTOM_WEEK_BUDGET_CENTS,
  parseCustomWeekBudget,
  parsePlannerPreferencesWithCustomBudget,
} from '../src/domain/customPlannerBudget.ts'
import {
  parsePlannerPreferences,
  serializePlannerPreferences,
} from '../src/domain/plannerPreferences.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'

// Exercise the actual React component through TypeScript's TSX transpiler.
const require = createRequire(import.meta.url)
const source = readFileSync(
  new URL('../src/features/planner/CustomBudgetInput.tsx', import.meta.url), 'utf8',
).replace(/^import\s+['"]\.\/customBudget\.css['"]\s*;?\s*$/m, '')
const compiled = ts.transpileModule(source, {
  fileName: 'CustomBudgetInput.tsx',
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])
const moduleShim = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  moduleShim, moduleShim.exports,
  (dependency) => {
    if (dependency === 'react') return React
    if (dependency === '../../domain/customPlannerBudget.ts') return {
      customWeekBudgetLabel,
      parseCustomWeekBudget,
    }
    if (dependency === 'react/jsx-runtime') return require(dependency)
    throw Error('Unexpected custom-budget dependency: ' + dependency)
  },
)
const { CustomBudgetInput } = moduleShim.exports
const catalog = m2Recipes.map(recipe => recipe.id)

test('product: Dutch decimal comma and dot produce the same exact-cent amount', () => {
  for (const [input, expected] of [
    ['27,50', 27.5], ['27.50', 27.5], [' 42,75 ', 42.75],
    ['0,01', 0.01], ['999,99', 999.99], ['1000', 1000],
    ['35', 35], ['35,1', 35.1],
  ]) {
    assert.equal(parseCustomWeekBudget(input), expected, input)
    assert.equal(customWeekBudgetLabel(expected).includes(','), true)
  }
  assert.equal(MAX_CUSTOM_WEEK_BUDGET_CENTS, 100000)
})

test('product: malformed, zero, negative, sub-cent and oversized budget drafts never commit', () => {
  for (const input of [
    '', ' ', '0', '0,00', '-1', '1.234,56', '27,501', '27.501',
    '1000,01', '1001', 'Infinity', 'NaN', '1e2', '27abc',
    '€27,50', 27.5, {}, null, '+27', ' 35 40',
  ]) assert.equal(parseCustomWeekBudget(input), null, String(input))
})

test('product: optional custom persistence accepts only cent exact within range', () => {
  const standard = {
    budget: 27.5, activeDays: ['Di'],
    recipeByDay: { Ma: 'tikka', Di: 'pasta', Wo: 'pasta', Do: 'tikka' },
  }
  const restored = parsePlannerPreferencesWithCustomBudget(
    serializePlannerPreferences(standard), m2InitialPlan, catalog,
  )
  assert.deepEqual(restored, standard)

  for (const unsupported of [0, -1, 27.501, 1000.01, 10_000, null, '27,50']) {
    const response = parsePlannerPreferencesWithCustomBudget(
      JSON.stringify({ budget: unsupported, activeDays: ['Di'], recipeByDay: {} }),
      m2InitialPlan, catalog,
    )
    assert.equal(response.budget, 35, String(unsupported))
  }
})

test('product: original explicitly chip-only preference parser stays restrictive', () => {
  assert.equal(parsePlannerPreferences(
    JSON.stringify({ budget: 27.5 }), m2InitialPlan, catalog,
  ).budget, 35)
  assert.equal(parsePlannerPreferences(
    JSON.stringify({ budget: 50 }), m2InitialPlan, catalog, 45, [45, 50, 55],
  ).budget, 50)
})

test('product: custom €27,50 compares real basket cents without a false savings claim', () => {
  const below = assessPlannerBudgetCents(1969, 27.5, 0)
  assert.equal(below.status, 'known')
  assert.equal(below.remainingCents, 781)
  const above = assessPlannerBudgetCents(3001, 27.5, 0)
  assert.equal(above.status, 'known')
  assert.equal(above.remainingCents, -251)
  assert.equal(above.overBudget, true)
  const incomplete = assessPlannerBudgetCents(1969, 27.5, 1)
  assert.equal(incomplete.status, 'unknown')
  assert.equal(incomplete.reason, 'unresolved-products')
  assert.equal(incomplete.knownMinimumCents, 1969)
  assert.equal('overBudget' in incomplete, false)
})

test('product: actual custom budget field is labelled, opt-in and touch-friendly', () => {
  const html = renderToStaticMarkup(React.createElement(CustomBudgetInput, {
    budget: 27.5, onBudgetChange() {},
  }))
  const css = readFileSync(new URL('../src/features/planner/customBudget.css', import.meta.url), 'utf8')
  const planner = readFileSync(new URL('../src/features/planner/PlannerView.tsx', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(html, /<form class="custom-budget-form"/)
  assert.match(html, /<label for="planner-custom-budget">Eigen weekbudget/)
  assert.match(html, /inputMode|inputmode="decimal"/i)
  assert.match(html, /value="27,50"/)
  assert.match(html, /type="submit"[^>]*>Instellen/)
  assert.match(css, /\.custom-budget-controls input\s*\{[^}]*min-height:\s*44px;/)
  assert.match(css, /\.custom-budget-controls button\s*\{[^}]*min-height:\s*44px;/)
  assert.match(planner, /<CustomBudgetInput budget=\{budget\} onBudgetChange=\{onBudgetChange\}/)
  assert.match(app, /parsePlannerPreferencesWithCustomBudget/)
})
