import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { euro } from '../src/lib/money.ts'

// Compile and SSR the actual review-only UI, not an alternative status helper.
const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const source = readFileSync(
  new URL('../src/features/planner/PlannerBudgetMoneyStatus.tsx', import.meta.url),
  'utf8',
)
const compiled = ts.transpileModule(source, {
  fileName: 'PlannerBudgetMoneyStatus.tsx',
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])
const mod = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  mod, mod.exports,
  (specifier) => {
    if (specifier === '../../lib/plannerBudgetCents.ts') return { assessPlannerBudgetCents }
    if (specifier === '../../lib/money.ts') return { euro }
    return require(specifier)
  },
)
const Component = mod.exports.PlannerBudgetMoneyStatus

function render(cost, budget, unresolved = 0) {
  return renderToStaticMarkup(React.createElement(Component, {
    basketTotalCents: cost,
    budgetEuros: budget,
    unresolvedLineCount: unresolved,
  }))
}

test('QA #1041: one-cent differences around the budget boundary remain exact', () => {
  const before = render(3499, 35)
  const equal = render(3500, 35)
  const above = render(3501, 35)
  assert.ok(before.includes(`${euro.formatCents(1)} over`), before)
  assert.ok(equal.includes(`${euro.formatCents(0)} over`), equal)
  assert.ok(above.includes(`${euro.formatCents(1)} boven budget`), above)
  assert.match(before, /aria-live="polite"/)
  assert.match(equal, /aria-live="polite"/)
  assert.match(above, /class="budget-status warning"/)
  assert.doesNotMatch(before + equal, /boven budget|warning/)
})

test('QA #1041: exact remaining cents survive deterministic repricing', () => {
  for (let i = 0; i <= 100; i++) {
    const cost = i
    const html = render(cost, 1)
    assert.ok(html.includes(`${euro.formatCents(100 - cost)} over`), html)
    assert.doesNotMatch(html, /boven budget/)
  }
})

test('QA #1041: every open basket reports uncertainty, never a fabricated euro remainder', () => {
  for (const unresolved of [1, 2, 11]) {
    for (const cost of [0, 1, 3500, 3501, Number.MAX_SAFE_INTEGER]) {
      const html = render(cost, 35, unresolved)
      const count = `${unresolved} ${unresolved === 1 ? 'mandregel' : 'mandregels'} open`
      assert.ok(html.includes(count), html)
      assert.match(html, /class="budget-status warning"/)
      assert.match(html, /aria-live="polite"/)
      assert.doesNotMatch(html, /€|boven budget|\sover\b|Budget niet beschikbaar/i)
    }
  }
})

test('QA #1041: a true zero budget still honestly reports exact cent overspend', () => {
  assert.ok(render(0, 0).includes(`${euro.formatCents(0)} over`))
  assert.ok(render(1, 0).includes(`${euro.formatCents(1)} boven budget`))
  assert.ok(render(199, 0).includes(`${euro.formatCents(199)} boven budget`))
  assert.match(render(199, 0, 1), /1 mandregel open/)
})

test('QA #1041: maximum safe integer cents are formatted without euro floating rounding', () => {
  const html = render(Number.MAX_SAFE_INTEGER, 0)
  assert.ok(html.includes(`${euro.formatCents(Number.MAX_SAFE_INTEGER)} boven budget`), html)
  assert.doesNotMatch(html, /NaN|Infinity|[—]/)
})

test('QA #1041: malformed inputs abstain with no monetary assertion', () => {
  for (const [cost, budget, unresolved] of [
    [-1, 35, 0], [1.5, 35, 0], [null, 35, 0], [NaN, 35, 0],
    [35, -1, 0], [35, NaN, 0], [35, 35.001, 0],
    [35, 35, -1], [35, 35, 1.5], [35, 35, '1'],
    [Number.MAX_SAFE_INTEGER + 1, 0, 0],
  ]) {
    const html = render(cost, budget, unresolved)
    assert.match(html, /Budget niet beschikbaar/)
    assert.match(html, /aria-live="polite"/)
    assert.doesNotMatch(html, /€|boven budget|\sover\b|mandregels? open/i)
  }
})
