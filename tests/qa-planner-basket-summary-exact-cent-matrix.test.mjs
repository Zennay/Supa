import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { euro } from '../src/lib/money.ts'

// Independently execute the proposed (unrouted) React component, not
// a handwritten mock basket summary or copied product assertion.
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
const mod = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  mod, mod.exports,
  (specifier) => {
    if (specifier === '../../lib/plannerBudgetCents.ts') return { assessPlannerBudgetCents }
    if (specifier === '../../lib/money.ts') return { euro }
    return require(specifier)
  },
)
const Summary = mod.exports.PlannerBasketSummaryCents

function render(costCents, budgetEuros, unresolvedLineCount = 0) {
  return renderToStaticMarkup(React.createElement(Summary, {
    basketTotalCents: costCents,
    budgetEuros,
    unresolvedLineCount,
  }))
}

function assertExact(cost, budgetEuros = 100) {
  const html = render(cost, budgetEuros)
  const amount = euro.formatCents(cost)
  assert.match(html, /^<strong data-budget-certainty="exact">/)
  assert.ok(html.includes(amount), `missing exact ${amount}: ${html}`)
  assert.doesNotMatch(html, /min\.|aria-label=|Bedrag onbekend|bespaar|savings/i)
}
function assertMinimum(cost, budgetEuros, unresolved) {
  const html = render(cost, budgetEuros, unresolved)
  const amount = euro.formatCents(cost)
  const phrase = `${unresolved} ${unresolved === 1 ? 'mandregel' : 'mandregels'} open`
  assert.match(html, /^<strong data-budget-certainty="known-minimum"/)
  assert.ok(html.includes(`aria-label="Bekend minimum ${amount}; ${phrase}"`), html)
  assert.ok(html.includes(`min. ${amount}`), html)
  assert.doesNotMatch(html, /Bedrag onbekend|bespaar|exact totaal|binnen budget/i)
}

test('QA #1041: every whole cent in the first euro remains an exact visible amount', () => {
  for (let cost = 0; cost <= 100; cost++) assertExact(cost, 100)
})

test('QA #1041: 128 deterministic cent amounts never lose their last cent in SSR', () => {
  for (let i = 0; i < 128; i++) {
    assertExact((i * 7919) % 100000)
  }
})

test('QA #1041: unknown lines always show an accessible minimum, not final basket money', () => {
  for (const unresolved of [1, 2, 11]) {
    for (const cost of [0, 1, 29, 203, 9999, 10000, 10001]) {
      assertMinimum(cost, 100, unresolved)
    }
  }
})

test('QA #1041: a zero budget may still display actual basket cents, not false savings', () => {
  for (const cost of [0, 1, 100, 10001]) {
    assertExact(cost, 0)
    assertMinimum(cost, 0, 2)
  }
})

test('QA #1041: high but safe cent totals format exactly, without Number euro rounding', () => {
  const nearLimit = Number.MAX_SAFE_INTEGER
  assertExact(nearLimit, 100)
  assertMinimum(nearLimit, 100, 11)
})

test('QA #1041: malformed money and uncertainty hide all amounts', () => {
  for (const [cost, budget, unresolved] of [
    [null, 100, 0], [-1, 100, 0], [1.5, 100, 0],
    [Infinity, 100, 0], [NaN, 100, 2],
    [12, NaN, 0], [12, Infinity, 0], [12, -1, 0],
    [12, 1.001, 0], [12, 100, -1], [12, 100, 1.5],
    [12, 100, '2'], [Number.MAX_SAFE_INTEGER + 1, 100, 0],
  ]) {
    const html = render(cost, budget, unresolved)
    assert.match(html, /data-budget-certainty="unavailable"/)
    assert.match(html, /Bedrag onbekend/)
    assert.doesNotMatch(html, /€|min\.|aria-label=|bespaar|savings/i)
  }
})
