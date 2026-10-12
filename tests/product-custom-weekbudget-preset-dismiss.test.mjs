import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { euro } from '../src/lib/money.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { RecipeEstimateDisclosure } from '../src/features/planner/RecipeEstimateDisclosure.ts'
import { parseCustomWeekBudgetCents, validCustomWeekBudgetEuros } from '../src/features/planner/customWeekBudget.ts'

// Execute the actual PlannerView handlers using synchronous local hook state.
// This is a controlled product interaction test, not a real browser test.
const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../src/features/planner/PlannerView.tsx', import.meta.url), 'utf8')
  .replace(/^import\s+['"]\.\/planner\.css['"]\s*;?\s*$/m, '')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'PlannerView.tsx',
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])

function setup() {
  const slots = []
  const budgets = []
  const resets = []
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
    throw Error('Unexpected PlannerView import: ' + name)
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(module, module.exports, imports)
  const props = {
    budget: 35,
    activeDays: [], plannedMeals: [], recipes: [],
    basketTotalCents: 1969, basketUnresolvedLineCount: 0,
    onBudgetChange(value) { budgets.push(value); props.budget = value },
    onToggleDay() {}, onRecipeChange() {}, onReset() { resets.push('reset') },
  }
  const nodes = element => {
    if (Array.isArray(element)) return element.flatMap(nodes)
    if (element == null || typeof element !== 'object' || !('props' in element)) return []
    return [element, ...nodes(element.props.children)]
  }
  const render = () => {
    cursor = 0
    return nodes(module.exports.PlannerView(props))
  }
  const maybe = (type, predicate) => render().find(x => x.type === type && predicate(x.props))
  const find = (type, predicate) => {
    const result = maybe(type, predicate)
    assert.ok(result, 'Expected ' + type)
    return result
  }
  const custom = () => find('button', p => p['aria-controls'] === 'custom-weekbudget-form')
  const input = () => find('input', p => p.id === 'custom-weekbudget-value')
  const preset = amount => find('button', p =>
    p.type === 'button' && p.children === euro.format(amount))
  return { budgets, resets, render, maybe, find, custom, input, preset }
}

test('product #1424: selecting a preset dismisses an unsaved custom budget draft and its error', () => {
  const app = setup()
  app.custom().props.onClick()
  assert.equal(app.custom().props['aria-expanded'], true)
  app.input().props.onChange({ target: { value: '27,501' } })
  app.find('form', p => p.id === 'custom-weekbudget-form').props.onSubmit({ preventDefault() {} })
  assert.ok(app.maybe('p', p => p.role === 'alert'), 'Invalid custom amount shows an error')
  app.preset(40).props.onClick()
  assert.deepEqual(app.budgets, [40], 'Preset must commit only its own budget, never the unsaved draft')
  assert.equal(app.custom().props['aria-expanded'], false, 'Preset selection closes the stale custom editor')
  assert.equal(app.maybe('form', p => p.id === 'custom-weekbudget-form'), undefined)
  app.custom().props.onClick()
  assert.equal(app.input().props.value, '', 'New custom edit begins with no stale invalid draft')
  assert.equal(app.maybe('p', p => p.role === 'alert'), undefined, 'Stale error is cleared')
  assert.deepEqual(app.budgets, [40], 'Reopening without submit does not commit a custom budget')
})

test('product #1424: an ordinary preset remains a direct selection without opening custom editor', () => {
  const app = setup()
  app.preset(30).props.onClick()
  assert.deepEqual(app.budgets, [30])
  assert.equal(app.custom().props['aria-expanded'], false)
  assert.equal(app.maybe('form', p => p.id === 'custom-weekbudget-form'), undefined)
})


test('product #1424: Reset discards a pending custom editor instead of leaving an obsolete form', () => {
  const app = setup()
  app.custom().props.onClick()
  app.input().props.onChange({ target: { value: '9999,99' } })
  app.find('form', p => p.id === 'custom-weekbudget-form').props.onSubmit({ preventDefault() {} })
  assert.ok(app.maybe('p', p => p.role === 'alert'))
  app.find('button', p => p.children === 'Reset').props.onClick()
  assert.deepEqual(app.resets, ['reset'], 'Existing planner reset callback still fires exactly once')
  assert.equal(app.custom().props['aria-expanded'], false, 'Reset closes pending custom editor')
  assert.equal(app.maybe('form', p => p.id === 'custom-weekbudget-form'), undefined)
  app.custom().props.onClick()
  assert.equal(app.input().props.value, '', 'Reset clears stale unsaved custom budget')
  assert.equal(app.maybe('p', p => p.role === 'alert'), undefined, 'Reset clears old validation error')
  assert.deepEqual(app.budgets, [], 'Reset does not synthesize extra budget change')
})
