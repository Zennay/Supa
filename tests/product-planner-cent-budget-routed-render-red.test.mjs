import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import * as plannerDomain from '../src/domain/planner.ts'
import { euro } from '../src/lib/money.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

// Product-core #1041: independent expected-RED UI contract on frozen #1042.
// Never modify active PlannerView.tsx owner #423 or planner.ts owner #342.
// Only synthetic cents cross the actual routed PlannerView presentation boundary.
const source = readFileSync(
  new URL('../src/features/planner/PlannerView.tsx', import.meta.url),
  'utf8',
)
const transpiled = ts.transpileModule(source, {
  fileName: 'PlannerView.tsx',
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
})
assert.deepEqual(transpiled.diagnostics, [])

const moduleRecord = { exports: {} }
new Function('module', 'exports', 'require', transpiled.outputText)(
  moduleRecord,
  moduleRecord.exports,
  (specifier) => {
    if (specifier === '../../domain/planner') return plannerDomain
    if (specifier === '../../lib/money') return { euro }
    if (specifier === './planner.css') return {}
    return require(specifier)
  },
)
const { PlannerView } = moduleRecord.exports

function render(basketTotalCents, basketUnresolvedLineCount = 0, budget = 35) {
  return renderToStaticMarkup(React.createElement(PlannerView, {
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
}

function renderedBudgetStatus(markup) {
  const match = markup.match(/<span class="budget-status(?: warning)?" aria-live="polite">([^<]*)<\/span>/)
  assert.ok(match, 'The real PlannerView must render an accessible budget status')
  return match[1]
}

test('product #1041: actual planner shows €15,31 remaining for €35 less €19,69', () => {
  const expected = assessPlannerBudgetCents(1969, 35, 0)
  assert.equal(expected.status, 'known')
  assert.equal(expected.remainingLabel, euro.formatCents(1531))
  const status = renderedBudgetStatus(render(1969))
  assert.equal(status, `${euro.formatCents(1531)} over`)
  assert.notEqual(status, '— over')
})

test('product #1041: actual planner shows cent-exact overspend without a dash', () => {
  const expected = assessPlannerBudgetCents(4001, 35, 0)
  assert.equal(expected.status, 'known')
  assert.equal(expected.overBudget, true)
  assert.equal(
    renderedBudgetStatus(render(4001)),
    `${euro.formatCents(501)} boven budget`,
  )
})

test('product #1041: exact equality shows zero remaining and not an overspend', () => {
  assert.equal(
    renderedBudgetStatus(render(3500)),
    `${euro.formatCents(0)} over`,
  )
})

test('product #1041: unresolved basket keeps unknown, not a fake exact remainder', () => {
  const expected = assessPlannerBudgetCents(1969, 35, 1)
  assert.equal(expected.status, 'unknown')
  const markup = render(1969, 1)
  assert.equal(renderedBudgetStatus(markup), '1 mandregel open')
  assert.ok(markup.includes('bekende minimum'), 'Incomplete prices are a known minimum only')
  assert.ok(!renderedBudgetStatus(markup).includes(euro.formatCents(1531)))
})

test('product #1041: price-only change immediately updates the rendered cent amount', () => {
  const earlier = renderedBudgetStatus(render(1969))
  const later = renderedBudgetStatus(render(1970))
  assert.equal(earlier, `${euro.formatCents(1531)} over`)
  assert.equal(later, `${euro.formatCents(1530)} over`)
  assert.notEqual(earlier, later)
})
