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
import {
  defaultPlannerPreferences,
  parsePlannerPreferences,
  serializePlannerPreferences,
} from '../src/domain/plannerPreferences.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'

// Independent product #1424 acceptance above parser-only fix #1768.
// All baskets here are reproducible fixture data, NEVER actual retailer evidence.
const require = createRequire(import.meta.url)
const validRecipes = m2Recipes.map(recipe => recipe.id)

function actualCustomInputHtml(budget) {
  const source = readFileSync(
    new URL('../src/features/planner/CustomBudgetInput.tsx', import.meta.url),
    'utf8',
  ).replace(/^import\s+['"]\.\/[^'"]+\.css['"]\s*;?\s*$/gm, '')
  const transpiled = ts.transpileModule(source, {
    fileName: 'CustomBudgetInput.tsx',
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  })
  assert.deepEqual(transpiled.diagnostics, [])
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', transpiled.outputText)(
    mod, mod.exports, (specifier) => {
      if (specifier === 'react') return React
      if (specifier === 'react/jsx-runtime') return require(specifier)
      if (specifier === '../../domain/customPlannerBudget.ts') {
        return { customWeekBudgetLabel, parseCustomWeekBudget }
      }
      throw new Error('Unreviewed custom budget UI import: ' + specifier)
    },
  )
  return renderToStaticMarkup(React.createElement(
    mod.exports.CustomBudgetInput, { budget, onBudgetChange() {} },
  ))
}

test('postrepair: actual custom budget UI presents the Dutch ceiling and explicit submit without losing input accessibility', () => {
  const html = actualCustomInputHtml(1000)
  assert.match(html, /value="1000,00"/)
  assert.match(html, /Vul €0,01 tot €1.000,00 in/)
  assert.match(html, /maxLength="8"/)
  assert.match(html, /inputMode="decimal"/)
  assert.match(html, /aria-describedby="planner-custom-budget-hint"/)
  assert.match(html, /<button type="submit"[^>]*>Instellen<\/button>/)
  assert.doesNotMatch(html, /role="alert"/)
})

test('postrepair: every explicit grouped upper-bound spelling becomes the same exact cent budget', () => {
  for (const input of ['1.000,00', '1.000,0', ' 1.000,00 ', '\t1.000,00\n', '1000,00', '1000.00']) {
    const budget = parseCustomWeekBudget(input)
    assert.equal(budget, 1000, input)
    assert.equal(customWeekBudgetLabel(budget), '1000,00')
    assert.equal(budget * 100, 100000)
  }
})

test('postrepair: grouped input never allows an ambiguous or larger budget', () => {
  for (const input of [
    '1.000', '1.000.', '1,000.00', '1.000.00',
    '01.000,00', '1.00,00', '1..000,00',
    '1.000,001', '1.000,01', '2.000,00',
    '999.999,99', '1 000,00', '1\u00a0000,00',
    '-1.000,00', '0.000,01',
  ]) {
    assert.equal(parseCustomWeekBudget(input), null, input)
  }
})

test('postrepair: grouping cannot alter real basket demand or exact euro-cent remaining budget', () => {
  const basket = buildOneStoreBasket({
    store: m2Store, products: m2Products,
    recipes: m2Recipes, plan: m2InitialPlan,
    activeDays: ['Wo'],
  })
  assert.equal(basket.unresolvedLineCount, 0)
  const before = JSON.stringify(basket)
  const fromDutch = assessPlannerBudgetCents(
    basket.totalCents, parseCustomWeekBudget('1.000,00'), 0,
  )
  const ungrouped = assessPlannerBudgetCents(
    basket.totalCents, parseCustomWeekBudget('1000.00'), 0,
  )
  assert.deepEqual(fromDutch, ungrouped)
  assert.equal(fromDutch.status, 'known')
  assert.equal(fromDutch.budgetCents, 100000)
  assert.equal(fromDutch.remainingCents, 100000 - basket.totalCents)
  assert.equal(JSON.stringify(basket), before)
})

test('postrepair: persisted grouped-input budget restores while old chip-only parsing stays unchanged', () => {
  const prefs = { ...defaultPlannerPreferences(m2InitialPlan), budget: parseCustomWeekBudget('1.000,00'), activeDays: ['Wo'] }
  const bytes = serializePlannerPreferences(prefs)
  const current = parsePlannerPreferencesWithCustomBudget(bytes, m2InitialPlan, validRecipes)
  assert.equal(current.budget, 1000)
  assert.deepEqual(current.activeDays, ['Wo'])
  assert.equal(parsePlannerPreferences(bytes, m2InitialPlan, validRecipes).budget, 35)
  assert.equal(serializePlannerPreferences(prefs), bytes)
})
