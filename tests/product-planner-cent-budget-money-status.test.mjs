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
const componentSource = readFileSync(
  new URL('../src/features/planner/PlannerBudgetMoneyStatus.tsx', import.meta.url),
  'utf8',
)
const compiled = ts.transpileModule(componentSource, {
  fileName: 'PlannerBudgetMoneyStatus.tsx',
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
const { PlannerBudgetMoneyStatus } = moduleRecord.exports

function status(costCents, budgetEuros, unresolved = 0) {
  const markup = renderToStaticMarkup(
    React.createElement(PlannerBudgetMoneyStatus, {
      basketTotalCents: costCents,
      budgetEuros,
      unresolvedLineCount: unresolved,
    }),
  )
  const match = markup.match(
    /^<span class="([^"]+)" aria-live="polite">([^<]*)<\/span>$/,
  )
  assert.ok(match, `accessibly rendered status expected: ${markup}`)
  return { className: match[1], text: match[2] }
}

test('product #1041: exact remaining cents are visible in Dutch', () => {
  assert.deepEqual(status(1969, 35), {
    className: 'budget-status',
    text: `${euro.formatCents(1531)} over`,
  })
})

test('product #1041: exact overspend renders euros from unsigned cents', () => {
  assert.deepEqual(status(4001, 35), {
    className: 'budget-status warning',
    text: `${euro.formatCents(501)} boven budget`,
  })
})

test('product #1041: exactly equal and zero-cost weeks never claim overspend', () => {
  assert.deepEqual(status(3500, 35), {
    className: 'budget-status',
    text: `${euro.formatCents(0)} over`,
  })
  assert.deepEqual(status(0, 35), {
    className: 'budget-status',
    text: `${euro.formatCents(3500)} over`,
  })
})

test('product #1041: unknown basket is not assigned a fake cent remainder', () => {
  assert.deepEqual(status(1969, 35, 1), {
    className: 'budget-status warning',
    text: '1 mandregel open',
  })
  assert.deepEqual(status(1969, 35, 2), {
    className: 'budget-status warning',
    text: '2 mandregels open',
  })
})

test('product #1041: malformed money abstains from a budget conclusion', () => {
  for (const [cost, budget, unresolved] of [
    [NaN, 35, 0],
    [1969, 35.001, 0],
    [-1, 35, 0],
    [1969, 35, -1],
    [null, 35, 0],
  ]) {
    assert.deepEqual(status(cost, budget, unresolved), {
      className: 'budget-status warning',
      text: 'Budget niet beschikbaar',
    })
  }
})

test('product #1041: only a one-cent reprice changes the rendered balance', () => {
  const first = status(1969, 35)
  const second = status(1970, 35)
  assert.equal(first.text, `${euro.formatCents(1531)} over`)
  assert.equal(second.text, `${euro.formatCents(1530)} over`)
  assert.notEqual(first.text, second.text)
})
