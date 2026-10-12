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
const moduleRecord = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  moduleRecord,
  moduleRecord.exports,
  (specifier) => {
    if (specifier === '../../lib/plannerBudgetCents.ts') {
      return { assessPlannerBudgetCents }
    }
    if (specifier === '../../lib/money.ts') return { euro }
    return require(specifier)
  },
)
const { PlannerBudgetProgressCents } = moduleRecord.exports

function render(cost, budget, unresolved = 0) {
  return renderToStaticMarkup(React.createElement(PlannerBudgetProgressCents, {
    basketTotalCents: cost,
    budgetEuros: budget,
    unresolvedLineCount: unresolved,
  }))
}

test('product #1041: exact cent amounts remain in progressbar accessible value', () => {
  const html = render(1969, 35)
  assert.match(html, /role="progressbar"/)
  assert.match(html, /data-budget-certainty="exact"/)
  assert.match(html, /aria-valuemin="0" aria-valuemax="100"/)
  assert.ok(html.includes(euro.formatCents(1969)))
  assert.ok(html.includes(euro.formatCents(3500)))
  assert.match(html, /aria-valuenow="56"/)
  assert.match(html, /width:56%/)
})

test('product #1041: one-cent repricing changes truthful text, not percentages arbitrarily', () => {
  const before = render(1969, 35)
  const after = render(1970, 35)
  assert.notEqual(before, after)
  assert.ok(before.includes(euro.formatCents(1969)))
  assert.ok(after.includes(euro.formatCents(1970)))
  assert.match(before, /aria-valuenow="56"/)
  assert.match(after, /aria-valuenow="56"/)
})

test('product #1041: incomplete cost is explicitly only a lower bound', () => {
  const html = render(4001, 35, 2)
  assert.match(html, /data-budget-certainty="known-minimum"/)
  assert.match(html, /aria-valuenow="100"/)
  assert.match(html, /width:100%/)
  assert.ok(html.includes(euro.formatCents(4001)))
  assert.match(html, /Bekend minimum/)
  assert.match(html, /2 mandregels open/)
  assert.doesNotMatch(html, /over budget|bespaar|binnen budget/i)
})

test('product #1041: incomplete below-budget never claims a remainder', () => {
  const html = render(1969, 35, 1)
  assert.match(html, /Bekend minimum/)
  assert.match(html, /1 mandregel open/)
  assert.doesNotMatch(html, /\sover\b|binnen budget|bespaar/i)
})

test('product #1041: invalid, missing and zero-denominator inputs have no false ARIA progress', () => {
  for (const [cost, budget, unresolved] of [
    [null, 35, 0],
    [-1, 35, 0],
    [1969.5, 35, 0],
    [1969, NaN, 0],
    [1969, 35, -1],
    [0, 0, 0],
    [50, 0, 0],
  ]) {
    const html = render(cost, budget, unresolved)
    assert.match(html, /Budgetvoortgang niet beschikbaar/)
    assert.doesNotMatch(html, /role="progressbar"|aria-valuenow|width:/)
  }
})
