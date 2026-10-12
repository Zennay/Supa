import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { euro } from '../src/lib/money.ts'

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

function render(cost, budget = 100, unresolved = 0) {
  return renderToStaticMarkup(React.createElement(PlannerBudgetProgressCents, {
    basketTotalCents: cost,
    budgetEuros: budget,
    unresolvedLineCount: unresolved,
  }))
}

test('product #1041: known costs below budget never claim 100% after rounding', () => {
  for (const cents of [9950, 9999]) {
    const html = render(cents)
    assert.match(html, /data-budget-certainty="exact"/)
    assert.match(html, /aria-valuenow="99"/)
    assert.match(html, /width:99%/)
    assert.ok(html.includes(euro.formatCents(cents)))
    assert.ok(html.includes(euro.formatCents(10000)))
    assert.doesNotMatch(html, /aria-valuenow="100"|width:100%/)
  }
})

test('product #1041: full and over-budget values remain capped at 100%', () => {
  for (const cents of [10000, 10001, 12000]) {
    const html = render(cents)
    assert.match(html, /aria-valuenow="100"/)
    assert.match(html, /width:100%/)
    assert.ok(html.includes(euro.formatCents(cents)))
  }
})

test('product #1041: an incomplete basket retains honest minimum-only semantics', () => {
  const html = render(9999, 100, 1)
  assert.match(html, /data-budget-certainty="known-minimum"/)
  assert.match(html, /aria-valuenow="99"/)
  assert.match(html, /Bekend minimum/)
  assert.match(html, /1 mandregel open/)
  assert.doesNotMatch(html, /bespaar|binnen budget|resterend/i)
})

test('product #1041: invalid and zero-budget inputs have no fabricated progress', () => {
  for (const [cost, budget, unresolved] of [
    [null, 100, 0],
    [-1, 100, 0],
    [9999.5, 100, 0],
    [9999, 100.001, 0],
    [9999, 100, -1],
    [0, 0, 0],
  ]) {
    const html = render(cost, budget, unresolved)
    assert.match(html, /Budgetvoortgang niet beschikbaar/)
    assert.doesNotMatch(html, /role="progressbar"|aria-valuenow|width:/)
  }
})
