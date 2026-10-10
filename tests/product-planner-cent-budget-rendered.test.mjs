import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

import { euro } from '../src/lib/money.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'

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
  if (moduleName === 'react/jsx-runtime') return require(moduleName)
  throw new Error(`Unexpected PlannerView dependency: ${moduleName}`)
}
new Function('module', 'exports', 'require', compiled.outputText)(
  pageModule, pageModule.exports, localRequire,
)
const { PlannerView } = pageModule.exports

function renderBudget(basketTotalCents, basketUnresolvedLineCount, budget = 35) {
  const html = renderToStaticMarkup(React.createElement(PlannerView, {
    budget,
    activeDays: [],
    plannedMeals: [],
    recipes: [],
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
