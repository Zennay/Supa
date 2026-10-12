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
import { parseCustomWeekBudgetCents, validCustomWeekBudgetEuros } from '../src/features/planner/customWeekBudget.ts'

// Independently compile the actual staged PlannerView and render actual React
// server markup. Static SSR checks must not be confused with Firefox or VPS
// hydration/interactivity proof; synthetic M2 cents only.
const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../src/features/planner/PlannerView.tsx', import.meta.url), 'utf8')
  .replace(/^import\s+['"]\.\/planner\.css['"]\s*;?\s*$/m, '')
const compiled = ts.transpileModule(source, {
  fileName: 'PlannerView.tsx',
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])
const module = { exports: {} }
const imported = name => {
  if (name === 'react') return React
  if (name === 'react/jsx-runtime') return require(name)
  if (name === '../../lib/money') return { euro }
  if (name === '../../lib/plannerBudgetCents.ts') return { assessPlannerBudgetCents }
  if (name === './RecipeEstimateDisclosure.ts') return { RecipeEstimateDisclosure }
  if (name === './customWeekBudget.ts') return { parseCustomWeekBudgetCents, validCustomWeekBudgetEuros }
  throw Error('Unexpected PlannerView import ' + name)
}
new Function('module', 'exports', 'require', compiled.outputText)(module, module.exports, imported)
const PlannerView = module.exports.PlannerView
assert.equal(typeof PlannerView, 'function')

const baseProps = Object.freeze({
  budget: 35,
  activeDays: [],
  plannedMeals: [],
  recipes: [],
  basketTotalCents: 1969,
  basketUnresolvedLineCount: 0,
  onBudgetChange() {},
  onToggleDay() {},
  onRecipeChange() {},
  onReset() {},
})
const markup = props =>
  renderToStaticMarkup(React.createElement(PlannerView, { ...baseProps, ...props }))

test('QA #1424: SSR of a restored custom €27,50 week budget retains cent-exact budget and accessible controls', () => {
  const html = markup({ budget: 27.5 })
  assert.match(html, /id="weekbudget-title"[^>]*>[^<]*27,50/)
  assert.match(html, /7,81 over/, '19.69 in known basket leaves exactly 7.81 euros')
  assert.match(html, /Eigen budget[^<]*27,50/, 'custom amount is the active selection')
  assert.match(html, /aria-pressed="true" aria-expanded="false" aria-controls="custom-weekbudget-form"/)
  assert.match(html, /aria-label="Gepland deel van het weekbudget"/)
  assert.match(html, /aria-valuemax="27.5"/)
  assert.match(html, /aria-valuenow="19.69"/)
  assert.doesNotMatch(html, /id="custom-weekbudget-form"/, 'closed editor is not submitted by SSR')
  assert.doesNotMatch(html, /role="alert"/)
  assert.doesNotMatch(html, /min\.\s*€/, 'complete known basket is never a minimum-only amount')
})

test('QA #1424: saved custom amount €1.000,00 is shown without a fabricated claim when products unresolved', () => {
  const html = markup({ budget: 1000, basketUnresolvedLineCount: 2 })
  assert.match(html, /1\.000,00/)
  assert.match(html, /2 mandregels open/)
  assert.match(html, /min\./, 'only a known basket minimum may be shown')
  assert.match(html, /aria-label="Bekend minimum van het weekbudget"/)
  assert.doesNotMatch(html, /(?:boven budget|over budget|bespaard)/i)
  assert.doesNotMatch(html, /\d[,\.]\d\d over/, 'not a false budget headroom claim')
})

test('QA #1424: ordinary preset €40 keeps pressed selection and does not render an obsolete custom editor', () => {
  const html = markup({ budget: 40 })
  assert.match(html, /id="weekbudget-title"[^>]*>[^<]*40,00/)
  assert.match(html, /20,31 over/)
  assert.doesNotMatch(html, /Eigen budget/)
  assert.match(html, /Ander bedrag instellen/)
  assert.match(html, /aria-pressed="false" aria-expanded="false" aria-controls="custom-weekbudget-form"/)
  assert.doesNotMatch(html, /id="custom-weekbudget-form"/)
  assert.doesNotMatch(html, /role="alert"/)
})
