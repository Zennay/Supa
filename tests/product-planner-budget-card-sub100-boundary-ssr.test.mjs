import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { euro } from '../src/lib/money.ts'
import { plannerBudgetStatusCopyNl } from '../src/lib/plannerBudgetStatusCopyNl.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const components = new Map()
const sources = [
  'PlannerBudgetStatusWithMinimum',
  'PlannerBudgetProgressCents',
  'PlannerBasketSummaryCents',
  'PlannerBudgetCardCents',
]
function loadComponent(name) {
  if (components.has(name)) return components.get(name)
  assert.ok(sources.includes(name))
  const source = readFileSync(
    new URL(`../src/features/planner/${name}.tsx`, import.meta.url),
    'utf8',
  )
  const compiled = ts.transpileModule(source, {
    fileName: `${name}.tsx`,
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
    mod,
    mod.exports,
    (specifier) => {
      if (specifier === '../../lib/plannerBudgetCents.ts') {
        return { assessPlannerBudgetCents }
      }
      if (specifier === '../../lib/plannerBudgetStatusCopyNl.ts') {
        return { plannerBudgetStatusCopyNl }
      }
      if (specifier === '../../lib/money.ts') return { euro }
      const componentName = /^\.\/(Planner[A-Za-z]+)\.tsx$/.exec(specifier)?.[1]
      if (componentName && sources.includes(componentName)) {
        return { [componentName]: loadComponent(componentName) }
      }
      return require(specifier)
    },
  )
  const value = mod.exports[name]
  assert.equal(typeof value, 'function')
  components.set(name, value)
  return value
}
const PlannerBudgetCardCents = loadComponent('PlannerBudgetCardCents')
function render(cost, budget = 35, open = 0, meals = 4, onBudgetChange = () => {}) {
  return renderToStaticMarkup(React.createElement(PlannerBudgetCardCents, {
    budgetEuros: budget,
    basketTotalCents: cost,
    unresolvedLineCount: open,
    activeMealCount: meals,
    onBudgetChange,
  }))
}


test('product #1041: complete budget card never renders full progress with cents still left', () => {
  for (const cents of [9950, 9999]) {
    const html = render(cents, 100)
    assert.match(html, /aria-valuenow="99"/)
    assert.match(html, /width:99%/)
    assert.ok(html.includes(euro.formatCents(10000 - cents)))
    assert.ok(html.includes(euro.formatCents(cents)))
    assert.match(html, /data-budget-certainty="exact"/)
    assert.doesNotMatch(html, /aria-valuenow="100"|width:100%|bespaar/i)
  }
})

test('product #1041: complete budget card becomes visually full only at actual cent threshold', () => {
  for (const cents of [10000, 10001]) {
    const html = render(cents, 100)
    assert.match(html, /aria-valuenow="100"/)
    assert.match(html, /width:100%/)
    assert.ok(html.includes(euro.formatCents(cents)))
  }
})

test('product #1041: incomplete card near full budget remains a minimum, not a remaining balance', () => {
  const html = render(9999, 100, 2)
  assert.match(html, /aria-valuenow="99"/)
  assert.match(html, /width:99%/)
  assert.match(html, /data-budget-certainty="known-minimum"/)
  assert.match(html, /Bekend minimum/)
  assert.match(html, /2 mandregels open/)
  assert.doesNotMatch(html, /0,01 over|binnen budget|bespaar/i)
})
