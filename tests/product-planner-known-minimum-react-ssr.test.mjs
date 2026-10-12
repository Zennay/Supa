import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { euro } from '../src/lib/money.ts'
import { plannerBudgetStatusCopyNl } from '../src/lib/plannerBudgetStatusCopyNl.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const source = readFileSync(
  new URL('../src/features/planner/PlannerBudgetStatusWithMinimum.tsx', import.meta.url),
  'utf8',
)
const compiled = ts.transpileModule(source, {
  fileName: 'PlannerBudgetStatusWithMinimum.tsx',
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
    if (specifier === '../../lib/plannerBudgetStatusCopyNl.ts') {
      return { plannerBudgetStatusCopyNl }
    }
    return require(specifier)
  },
)
const { PlannerBudgetStatusWithMinimum } = moduleRecord.exports

function render(costCents, budgetEuros, unresolved = 0) {
  return renderToStaticMarkup(
    React.createElement(PlannerBudgetStatusWithMinimum, {
      basketTotalCents: costCents,
      budgetEuros,
      unresolvedLineCount: unresolved,
    }),
  )
}

test('product #1041: actual React lower-bound warning is accessible and explicitly minimum-only', () => {
  const html = render(4001, 35, 2)
  assert.match(html, /class="budget-status warning"/)
  assert.match(html, /aria-live="polite"/)
  assert.match(html, /data-budget-certainty="known-minimum"/)
  assert.ok(html.includes('Minimaal'))
  assert.ok(html.includes(euro.formatCents(501)))
  assert.ok(html.includes('2 mandregels open'))
  assert.doesNotMatch(html, /\sover<|bespaar|korting|exacte totaal/i)
})

test('product #1041: unresolved at/below budget cannot show an exact remainder', () => {
  for (const [cost, count] of [[1969, 1], [3500, 2]]) {
    const html = render(cost, 35, count)
    assert.match(html, /data-budget-certainty="known-minimum"/)
    assert.doesNotMatch(html, /Minimaal|\sover<|boven budget|bespaar/i)
    assert.match(html, new RegExp(`${count} mandregel${count === 1 ? '' : 's'} open`))
  }
})

test('product #1041: exact cents and one-cent repricing remain visible', () => {
  const first = render(1969, 35, 0)
  const second = render(1970, 35, 0)
  assert.match(first, /data-budget-certainty="exact"/)
  assert.ok(first.includes(euro.formatCents(1531)))
  assert.ok(second.includes(euro.formatCents(1530)))
  assert.notEqual(first, second)
  assert.doesNotMatch(first, /class="budget-status warning"/)
})

test('product #1041: malformed evidence is warning-only without showing monetary claims', () => {
  for (const [cost, budget, unresolved] of [
    [null, 35, 1],
    [4001.5, 35, 1],
    [4001, 35.001, 1],
    [4001, 35, -1],
  ]) {
    const html = render(cost, budget, unresolved)
    assert.match(html, /class="budget-status warning"/)
    assert.match(html, /data-budget-certainty="unavailable"/)
    assert.ok(html.includes('Budget niet beschikbaar'))
    assert.doesNotMatch(html, /€|Minimaal|\sover<|boven budget/)
  }
})
