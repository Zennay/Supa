import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { euro } from '../src/lib/money.ts'

// Synthetic, independent quality-validation of proposed (unrouted) product #1041.
// The expected percentage is derived with integer cents, not IEEE-754 division.
const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const source = readFileSync(
  new URL('../src/features/planner/PlannerBudgetProgressCents.tsx', import.meta.url),
  'utf8',
)
const compiled = ts.transpileModule(source, {
  fileName: 'PlannerBudgetProgressCents.tsx',
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])
const record = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  record,
  record.exports,
  (specifier) => {
    if (specifier === '../../lib/plannerBudgetCents.ts') {
      return { assessPlannerBudgetCents }
    }
    if (specifier === '../../lib/money.ts') return { euro }
    return require(specifier)
  },
)
const { PlannerBudgetProgressCents } = record.exports

function render(costCents, budgetEuros, unresolvedLineCount = 0) {
  return renderToStaticMarkup(React.createElement(PlannerBudgetProgressCents, {
    basketTotalCents: costCents,
    budgetEuros,
    unresolvedLineCount,
  }))
}

function assertExactPercent(costCents, budgetCents, unresolved = 0) {
  assert.ok(Number.isSafeInteger(costCents) && Number.isSafeInteger(budgetCents))
  assert.ok(budgetCents > 0)
  const percentage = Number(
    (BigInt(costCents) * 100n) / BigInt(budgetCents),
  )
  const expected = Math.min(percentage, 100)
  const html = render(costCents, budgetCents / 100, unresolved)
  assert.match(html, /role="progressbar"/)
  assert.ok(
    html.includes('aria-valuenow="' + expected + '"'),
    'cent-exact progress must be ' + expected + '%: ' + html,
  )
  assert.ok(
    html.includes('width:' + expected + '%'),
    'visual width must agree with cent-exact percentage: ' + html,
  )
  assert.ok(html.includes(euro.formatCents(costCents)))
  assert.ok(html.includes(euro.formatCents(budgetCents)))
  assert.match(
    html,
    unresolved ? /data-budget-certainty="known-minimum"/ : /data-budget-certainty="exact"/,
  )
}

test('qa #1041 expected RED: 29 cents of one euro must be 29%, not float-rounded 28%', () => {
  assertExactPercent(29, 100)
})

test('qa #1041 expected RED: 29 of 50 euros must be 58%, not float-rounded 57%', () => {
  assertExactPercent(2900, 5000)
})

test('qa #1041 expected RED: unresolved basket percentage still uses integer-cent floor', () => {
  assertExactPercent(203, 350, 2)
})

test('qa #1041 controls: common valid, one-cent-before-full and overbudget remain honest', () => {
  assertExactPercent(1969, 3500)
  assertExactPercent(9999, 10000)
  assertExactPercent(10001, 10000)
})

test('qa #1041 control: zero denominator and malformed cents disclose no made-up percentage', () => {
  for (const [cost, budget] of [[0, 0], [29.5, 1], [-1, 1], [29, 0]]) {
    const html = render(cost, budget)
    assert.match(html, /Budgetvoortgang niet beschikbaar/)
    assert.doesNotMatch(html, /role="progressbar"|aria-valuenow=|width:/)
  }
})
