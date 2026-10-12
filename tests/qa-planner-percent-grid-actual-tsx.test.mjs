import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { euro } from '../src/lib/money.ts'

// Quality-validation of the ACTUAL unrouted React TSX; no mock percent logic.
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
const mod = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  mod, mod.exports,
  (specifier) => {
    if (specifier === '../../lib/plannerBudgetCents.ts') return { assessPlannerBudgetCents }
    if (specifier === '../../lib/money.ts') return { euro }
    return require(specifier)
  },
)
const Component = mod.exports.PlannerBudgetProgressCents

function render(costCents, budgetEuros, unresolvedLineCount = 0) {
  return renderToStaticMarkup(React.createElement(Component, {
    basketTotalCents: costCents,
    budgetEuros,
    unresolvedLineCount,
  }))
}

function assertProgress({ costCents, budgetCents, unresolved = 0 }) {
  assert.ok(Number.isSafeInteger(costCents) && costCents >= 0)
  assert.ok(Number.isSafeInteger(budgetCents) && budgetCents > 0)
  const exact = costCents >= budgetCents
    ? 100
    : Number((BigInt(costCents) * 100n) / BigInt(budgetCents))
  const html = render(costCents, budgetCents / 100, unresolved)
  const failureContext = `cost=${costCents}c budget=${budgetCents}c unresolved=${unresolved}\n${html}`
  assert.match(html, /role="progressbar"/, failureContext)
  assert.ok(html.includes(`aria-valuenow="${exact}"`), failureContext)
  assert.ok(html.includes(`style="width:${exact}%"`), failureContext)
  assert.ok(html.includes('aria-valuemin="0"') && html.includes('aria-valuemax="100"'), failureContext)
  assert.ok(html.includes(euro.formatCents(costCents)), failureContext)
  assert.ok(html.includes(euro.formatCents(budgetCents)), failureContext)
  assert.ok(html.includes(`data-budget-certainty="${unresolved ? 'known-minimum' : 'exact'}"`), failureContext)
  if (unresolved) {
    assert.ok(html.includes('Bekend minimum:'), failureContext)
    assert.ok(html.includes(`${unresolved} ${unresolved === 1 ? 'mandregel' : 'mandregels'} open`), failureContext)
    assert.doesNotMatch(html, /aria-valuetext="Gepland:/, failureContext)
  } else {
    assert.ok(html.includes('aria-valuetext="Gepland:'), failureContext)
  }
}

test('QA #1041: all 101 exact integer percentage boundaries are correct in the real TSX', () => {
  for (let costCents = 0; costCents <= 100; costCents++) {
    assertProgress({ costCents, budgetCents: 100 })
  }
})

test('QA #1041: a 100-euro basket preserves all 101 whole percentages', () => {
  for (let percent = 0; percent <= 100; percent++) {
    assertProgress({ costCents: percent * 100, budgetCents: 10000 })
  }
})

test('QA #1041: 99.9%, over-budget and sub-percent one-cent boundaries never round up', () => {
  for (const [costCents, budgetCents] of [
    [1, 199], [2, 199], [29, 100], [203, 350],
    [9999, 10000], [10000, 10000], [10001, 10000],
    [99999, 100000], [100000, 100000], [100001, 100000],
  ]) {
    assertProgress({ costCents, budgetCents })
  }
})

test('QA #1041: incomplete baskets expose only a known minimum, never a complete claim', () => {
  for (const unresolved of [1, 2, 11]) {
    for (const costCents of [0, 1, 203, 350, 999, 1000, 1001]) {
      assertProgress({ costCents, budgetCents: 1000, unresolved })
    }
  }
})

test('QA #1041: deterministic broad cent grid agrees with an independent BigInt floor', () => {
  for (let i = 0; i < 128; i++) {
    assertProgress({ costCents: (i * 7919) % 10001, budgetCents: 10000 })
  }
})

test('QA #1041: malformed or zero-denominator budget never invents progress or money', () => {
  for (const [cost, budget, unresolved] of [
    [0, 0, 0], [12, 0, 2], [-1, 1, 0], [12.5, 1, 0],
    [Number.NaN, 1, 0], [12, Number.POSITIVE_INFINITY, 0],
    [12, -1, 0], [12, 1, -1], [12, 1, 1.5], [12, '1', 0],
    [Number.MAX_SAFE_INTEGER + 1, 100, 0],
  ]) {
    const html = render(cost, budget, unresolved)
    assert.match(html, /Budgetvoortgang niet beschikbaar/)
    assert.doesNotMatch(html, /role="progressbar"|aria-valuenow=|width:|aria-valuetext=/)
  }
})
