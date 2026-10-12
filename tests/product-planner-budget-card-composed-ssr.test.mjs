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

test('product #1041: composite budget card renders three consistent cent-exact places', () => {
  const html = render(1969)
  assert.match(html, /aria-labelledby="weekbudget-title"/)
  assert.ok(html.includes(euro.formatCents(3500)))
  assert.ok(html.includes(euro.formatCents(1531)))
  assert.ok(html.includes(euro.formatCents(1969)))
  assert.match(html, /data-budget-certainty="exact"/g)
  assert.match(html, /aria-live="polite"/)
  assert.match(html, /role="progressbar"/)
  assert.match(html, /aria-valuetext="Gepland:/)
  assert.match(html, /4 maaltijden actief/)
})

test('product #1041: cent price refresh recomputes status, progress value and basket amount', () => {
  const before = render(1969)
  const after = render(1970)
  assert.notEqual(before, after)
  assert.ok(before.includes(euro.formatCents(1531)))
  assert.ok(after.includes(euro.formatCents(1530)))
  assert.ok(before.includes(euro.formatCents(1969)))
  assert.ok(after.includes(euro.formatCents(1970)))
  assert.match(after, /aria-valuenow="56"/)
})

test('product #1041: partial overspend remains known-minimum across all three displays', () => {
  const html = render(4001, 35, 2)
  assert.match(html, /Minimaal/)
  assert.ok(html.includes(euro.formatCents(501)))
  assert.match(html, /data-budget-certainty="known-minimum"/g)
  assert.match(html, /Bekend minimum/)
  assert.match(html, /2 mandregels open/)
  assert.match(html, /Nog 2 productmatches open/)
  assert.doesNotMatch(html, /bespaar|binnen budget|exact totaal/i)
})

test('product #1041: partial below-budget cannot claim unspent money', () => {
  const html = render(1969, 35, 1)
  assert.match(html, /min\./)
  assert.match(html, /1 mandregel open/)
  assert.doesNotMatch(html, /1531|15,31|\sover<|binnen budget|bespaar/i)
})

test('product #1041: invalid money abstains consistently without fake zero progress', () => {
  const html = render(1969.5, 35, 0)
  assert.match(html, /Budget onbekend/)
  assert.match(html, /Budget niet beschikbaar/)
  assert.match(html, /Budgetvoortgang niet beschikbaar/)
  assert.match(html, /Bedrag onbekend/)
  assert.doesNotMatch(html, /role="progressbar"|aria-valuenow/)
})

test('product #1041: zero denominator retains honest exact zero summary but no fake percent', () => {
  const html = render(0, 0, 0, 0)
  assert.ok(html.includes(euro.formatCents(0)))
  assert.match(html, /0 maaltijden actief/)
  assert.match(html, /Budgetvoortgang niet beschikbaar/)
  assert.doesNotMatch(html, /aria-valuenow/)
  assert.match(html, /data-budget-certainty="exact"/)
})

test('product #1041: budget chips forward actual numeric cents choices through component props', () => {
  const chosen = []
  const tree = PlannerBudgetCardCents({
    budgetEuros: 35,
    basketTotalCents: 1969,
    unresolvedLineCount: 0,
    activeMealCount: 4,
    onBudgetChange: (value) => chosen.push(value),
  })
  const children = React.Children.toArray(tree.props.children)
  const chips = children.find((node) => node.props.className === 'budget-options')
  assert.ok(chips)
  const buttons = React.Children.toArray(chips.props.children)
  assert.deepEqual(buttons.map((button) => button.props['aria-pressed']), [false, true, false])
  buttons[0].props.onClick()
  buttons[2].props.onClick()
  assert.deepEqual(chosen, [30, 40])
  assert.ok(render(1969, 30).includes(euro.formatCents(1031)))
})

test('product #1041: malformed active-meal counts never claim a fabricated count', () => {
  const html = render(1969, 35, 0, -1)
  assert.match(html, /Actieve maaltijden onbekend/)
  assert.doesNotMatch(html, /-1 maaltijden/)
})
