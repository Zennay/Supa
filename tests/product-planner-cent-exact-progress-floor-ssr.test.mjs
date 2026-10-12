import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { euro } from '../src/lib/money.ts'

// Execute the actual proposed React TSX; do not model the percentage copy
// separately in a test-only implementation.
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
    if (specifier === '../../lib/plannerBudgetCents.ts') return { assessPlannerBudgetCents }
    if (specifier === '../../lib/money.ts') return { euro }
    return require(specifier)
  },
)
const { PlannerBudgetProgressCents } = record.exports

function render(costCents, budgetCents, unresolved = 0) {
  return renderToStaticMarkup(
    React.createElement(PlannerBudgetProgressCents, {
      basketTotalCents: costCents,
      budgetEuros: budgetCents / 100,
      unresolvedLineCount: unresolved,
    }),
  )
}

function assertPercent(costCents, budgetCents, unresolved = 0) {
  const expected = costCents >= budgetCents
    ? 100
    : Number(BigInt(costCents) * 100n / BigInt(budgetCents))
  const html = render(costCents, budgetCents, unresolved)
  assert.match(html, /role="progressbar"/)
  assert.ok(html.includes(`aria-valuenow="${expected}"`), html)
  assert.ok(html.includes(`width:${expected}%`), html)
  assert.ok(html.includes(euro.formatCents(costCents)), html)
  assert.ok(html.includes(euro.formatCents(budgetCents)), html)
  assert.ok(html.includes(
    unresolved
      ? 'data-budget-certainty="known-minimum"'
      : 'data-budget-certainty="exact"',
  ), html)
  return html
}

test('product #1041: exact floor does not understate 29/100, 29/50 or 203/350 cents', () => {
  assertPercent(29, 100)
  assertPercent(2900, 5000)
  assertPercent(203, 350, 2)
})

test('product #1041: ordinary integer-cent ratios follow mathematical floor', () => {
  for (const [known, budget] of [
    [0, 3500], [1, 3500], [1969, 3500], [1970, 3500],
    [2499, 5000], [2500, 5000], [3499, 3500],
    [3500, 3500], [3501, 3500], [0, 1], [1, 1],
  ]) assertPercent(known, budget)
})

test('product #1041: near-MAX_SAFE_INTEGER cents cannot overflow the percentage multiply', () => {
  // 100× MAX_SAFE_INTEGER is not a Number-safe integer; BigInt arithmetic
  // clamps to a safe [0, 100] percentage prior to rendering the DOM value.
  assertPercent(Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER)
  assertPercent(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
  assertPercent(Number.MAX_SAFE_INTEGER, 100)
})

test('product #1041: incomplete baskets disclose only a known minimum', () => {
  const html = assertPercent(2900, 5000, 2)
  assert.match(html, /Bekend minimum:/)
  assert.match(html, /2 mandregels open/)
  assert.doesNotMatch(html, /binnen budget|bespaar|\sover\b/i)
})

test('product #1041: zero budget or invalid inputs omit false aria progress', () => {
  const invalid = [
    [0, 0, 0], [29, 0, 0], [-1, 100, 0], [29.5, 100, 0],
    [29, 100, -1], [null, 100, 0], [29, NaN, 0],
  ]
  for (const [known, budget, unresolved] of invalid) {
    const html = render(known, budget, unresolved)
    assert.match(html, /Budgetvoortgang niet beschikbaar/)
    assert.doesNotMatch(html, /role="progressbar"|aria-valuenow|width:/)
  }
})
