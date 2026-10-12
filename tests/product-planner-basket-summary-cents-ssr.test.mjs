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
  new URL('../src/features/planner/PlannerBasketSummaryCents.tsx', import.meta.url),
  'utf8',
)
const compiled = ts.transpileModule(source, {
  fileName: 'PlannerBasketSummaryCents.tsx',
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
const { PlannerBasketSummaryCents } = record.exports

function render(cost, budget, unresolved = 0) {
  return renderToStaticMarkup(React.createElement(PlannerBasketSummaryCents, {
    basketTotalCents: cost,
    budgetEuros: budget,
    unresolvedLineCount: unresolved,
  }))
}

test('product #1041: basket summary uses exact integer cents, including repricing', () => {
  const previous = render(1969, 35)
  const repriced = render(1970, 35)
  assert.match(previous, /data-budget-certainty="exact"/)
  assert.ok(previous.includes(euro.formatCents(1969)))
  assert.ok(repriced.includes(euro.formatCents(1970)))
  assert.notEqual(previous, repriced)
  assert.doesNotMatch(previous, /min\.|onbekend/i)
})

test('product #1041: open basket is minimum-only even when its bound exceeds budget', () => {
  const html = render(4001, 35, 2)
  assert.match(html, /data-budget-certainty="known-minimum"/)
  assert.match(html, /min\./)
  assert.ok(html.includes(euro.formatCents(4001)))
  assert.match(html, /aria-label="Bekend minimum/)
  assert.match(html, /2 mandregels open/)
  assert.doesNotMatch(html, /bespaar|binnen budget|exact totaal/i)
})

test('product #1041: an open zero-priced basket still cannot claim a complete €0 total', () => {
  const html = render(0, 35, 1)
  assert.match(html, /data-budget-certainty="known-minimum"/)
  assert.match(html, /min\./)
  assert.ok(html.includes(euro.formatCents(0)))
  assert.match(html, /1 mandregel open/)
})

test('product #1041: invalid counts, amounts and budgets never display money', () => {
  for (const [cost, budget, count] of [
    [-1, 35, 0],
    [1969.5, 35, 0],
    [null, 35, 0],
    [1969, 35.001, 0],
    [1969, 35, -1],
  ]) {
    const html = render(cost, budget, count)
    assert.match(html, /data-budget-certainty="unavailable"/)
    assert.match(html, /Bedrag onbekend/)
    assert.doesNotMatch(html, /€|min\.|boven budget|bespaar/i)
  }
})

test('product #1041: a legitimate zero-weekbudget with complete empty basket stays exact', () => {
  const html = render(0, 0, 0)
  assert.match(html, /data-budget-certainty="exact"/)
  assert.ok(html.includes(euro.formatCents(0)))
})
