import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { euro } from '../src/lib/money.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { RecipeEstimateDisclosure } from '../src/features/planner/RecipeEstimateDisclosure.ts'
import { parseCustomWeekBudgetCents, validCustomWeekBudgetEuros } from '../src/features/planner/customWeekBudget.ts'

// These are synthetic M2-only UI handler checks on the *real compiled* Planner.
// No hydrated browser, source-permission, measured retailer prices or savings proof.
const require = createRequire(import.meta.url)
const source = readFileSync(
  new URL('../src/features/planner/PlannerView.tsx', import.meta.url), 'utf8',
).replace(/^import\s+['"]\.\/planner\.css['"]\s*;?\s*$/m, '')
const transpiled = ts.transpileModule(source, {
  fileName: 'PlannerView.tsx',
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
  reportDiagnostics: true,
})
assert.deepEqual(transpiled.diagnostics, [])

function mountedPlanner(initialBudget = 35) {
  const slots = []
  const committed = []
  let resets = 0
  let cursor = 0
  const useState = initial => {
    const index = cursor++
    if (!(index in slots)) slots[index] = initial
    return [slots[index], next => {
      slots[index] = typeof next === 'function' ? next(slots[index]) : next
    }]
  }
  const imports = name => {
    if (name === 'react') return { useState }
    if (name === 'react/jsx-runtime') return require(name)
    if (name === '../../lib/money') return { euro }
    if (name === '../../lib/plannerBudgetCents.ts') return { assessPlannerBudgetCents }
    if (name === './RecipeEstimateDisclosure.ts') return { RecipeEstimateDisclosure }
    if (name === './customWeekBudget.ts') return { parseCustomWeekBudgetCents, validCustomWeekBudgetEuros }
    throw Error('Unexpected Planner dependency: ' + name)
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', transpiled.outputText)(
    module, module.exports, imports,
  )
  const props = {
    budget: initialBudget,
    activeDays: [], plannedMeals: [], recipes: [],
    basketTotalCents: 1969, basketUnresolvedLineCount: 0,
    onBudgetChange(value) { committed.push(value); props.budget = value },
    onToggleDay() {}, onRecipeChange() {},
    onReset() { resets++; props.budget = 35 },
  }
  const descendants = node => {
    if (Array.isArray(node)) return node.flatMap(descendants)
    if (node === null || typeof node !== 'object' || !('props' in node)) return []
    return [node, ...descendants(node.props.children)]
  }
  const render = () => {
    cursor = 0
    return descendants(module.exports.PlannerView(props))
  }
  const find = (type, predicate) => {
    const item = render().find(node => node.type === type && predicate(node.props))
    assert.ok(item, 'Expected visible ' + type)
    return item
  }
  const optional = (type, predicate) =>
    render().find(node => node.type === type && predicate(node.props))
  const editor = () => find('button', p => p['aria-controls'] === 'custom-weekbudget-form')
  const input = () => find('input', p => p.id === 'custom-weekbudget-value')
  const enter = value => input().props.onChange({ target: { value } })
  const submit = () => {
    let prevented = 0
    find('form', p => p.id === 'custom-weekbudget-form').props.onSubmit({
      preventDefault() { prevented++ },
    })
    assert.equal(prevented, 1)
  }
  const preset = amount => find('button', p => p.children === euro.format(amount)).props.onClick()
  const reset = () => find('button', p => p.children === 'Reset').props.onClick()
  return { committed, props, editor, input, enter, submit, preset, reset, optional, find, get resets() { return resets } }
}

test('product #1424: preset after invalid custom draft dismisses error and prevents accidental overwrite', () => {
  const page = mountedPlanner(27.5)
  page.editor().props.onClick()
  page.enter('1.000,01')
  page.submit()
  assert.equal(page.input().props['aria-invalid'], true)
  assert.deepEqual(page.committed, [])
  page.preset(40)
  assert.deepEqual(page.committed, [40])
  assert.equal(page.props.budget, 40)
  assert.equal(page.editor().props['aria-expanded'], false)
  assert.equal(page.optional('form', p => p.id === 'custom-weekbudget-form'), undefined)
  page.editor().props.onClick()
  assert.equal(page.input().props.value, '', 'old failed amount must not come back')
  assert.equal(page.input().props['aria-invalid'], undefined)
  assert.equal(page.optional('p', p => p.role === 'alert'), undefined)
  assert.deepEqual(page.committed, [40])
})

test('product #1424: reset from failed editor clears old draft and invokes reset exactly once', () => {
  const page = mountedPlanner(27.5)
  page.editor().props.onClick()
  page.enter('niet-een-bedrag')
  page.submit()
  assert.equal(page.input().props['aria-invalid'], true)
  page.reset()
  assert.equal(page.resets, 1)
  assert.deepEqual(page.committed, [])
  assert.equal(page.props.budget, 35)
  assert.equal(page.editor().props['aria-expanded'], false)
  assert.equal(page.optional('form', p => p.id === 'custom-weekbudget-form'), undefined)
  page.editor().props.onClick()
  assert.equal(page.input().props.value, '')
  assert.equal(page.input().props['aria-invalid'], undefined)
  assert.equal(page.optional('p', p => p.role === 'alert'), undefined)
})

test('product #1424: closing and reopening custom editor discards unsaved invalid text, not saved budget', () => {
  const page = mountedPlanner(27.5)
  page.editor().props.onClick()
  assert.equal(page.input().props.value, '27,50')
  page.enter('9999')
  page.submit()
  assert.equal(page.input().props['aria-invalid'], true)
  page.editor().props.onClick()
  assert.equal(page.editor().props['aria-expanded'], false)
  page.editor().props.onClick()
  assert.equal(page.input().props.value, '27,50')
  assert.equal(page.input().props['aria-invalid'], undefined)
  assert.deepEqual(page.committed, [])
  assert.equal(page.props.budget, 27.5)
})

test('product #1424: one-cent minimum submits exactly and displays cent-based overspend honestly', () => {
  const page = mountedPlanner()
  page.editor().props.onClick()
  page.enter('0,01')
  page.submit()
  assert.deepEqual(page.committed, [0.01])
  assert.equal(page.props.budget, 0.01)
  assert.equal(page.find('strong', p => p.id === 'weekbudget-title').props.children, euro.format(0.01))
  const progress = page.find('div', p => p.role === 'progressbar')
  assert.equal(progress.props['aria-valuemax'], 0.01)
  assert.equal(progress.props['aria-valuenow'], 0.01)
  assert.equal(page.find('span', p => p.className === 'budget-status warning').props.children,
    `${euro.formatCents(1968)} boven budget`)
})
