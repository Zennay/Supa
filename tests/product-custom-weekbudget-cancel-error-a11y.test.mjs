import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { euro } from '../src/lib/money.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { RecipeEstimateDisclosure } from '../src/features/planner/RecipeEstimateDisclosure.ts'
import {
  parseCustomWeekBudgetCents,
  validCustomWeekBudgetEuros,
} from '../src/features/planner/customWeekBudget.ts'

// Actual TypeScript-compiled PlannerView handlers with disposable, synchronous
// React state. This is not Firefox/mobile hydration or persisted price evidence.
const require = createRequire(import.meta.url)
const source = readFileSync(
  new URL('../src/features/planner/PlannerView.tsx', import.meta.url), 'utf8',
).replace(/^import\s+['"]\.\/planner\.css['"]\s*;?\s*$/m, '')
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

function page(initialBudget = 35) {
  const slots = []
  const changes = []
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
    if (name === './customWeekBudget.ts') {
      return { parseCustomWeekBudgetCents, validCustomWeekBudgetEuros }
    }
    throw new Error('Unexpected dependency: ' + name)
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(module, module.exports, imports)
  const props = {
    budget: initialBudget,
    activeDays: [], plannedMeals: [], recipes: [],
    basketTotalCents: 1969, basketUnresolvedLineCount: 0,
    onBudgetChange(value) { changes.push(value); props.budget = value },
    onToggleDay() {}, onRecipeChange() {}, onReset() {},
  }
  const nodes = item => {
    if (Array.isArray(item)) return item.flatMap(nodes)
    if (item == null || typeof item !== 'object' || !('props' in item)) return []
    return [item, ...nodes(item.props.children)]
  }
  const render = () => {
    cursor = 0
    return nodes(module.exports.PlannerView(props))
  }
  const maybe = (type, predicate) => render().find(node => node.type === type && predicate(node.props))
  const find = (type, predicate) => {
    const node = maybe(type, predicate)
    assert.ok(node, 'Missing ' + String(type))
    return node
  }
  const toggle = () => find('button', p => p['aria-controls'] === 'custom-weekbudget-form')
  const input = () => find('input', p => p.id === 'custom-weekbudget-value')
  const error = () => maybe('p', p => p.role === 'alert')
  const edit = value => input().props.onChange({ target: { value } })
  const cancel = () => find('button', p => p.children === 'Annuleren').props.onClick()
  const submit = () => {
    let prevented = false
    find('form', p => p.id === 'custom-weekbudget-form').props.onSubmit({
      preventDefault() { prevented = true },
    })
    assert.equal(prevented, true)
  }
  return { changes, props, maybe, find, toggle, input, error, edit, cancel, submit }
}

test('product #1424: cancel is a non-submit 44px chip and discards an uncommitted amount', () => {
  const app = page()
  app.toggle().props.onClick()
  assert.equal(app.find('button', p => p.children === 'Annuleren').props.type, 'button')
  app.edit('27,50')
  app.cancel()
  assert.deepEqual(app.changes, [])
  assert.equal(app.props.budget, 35)
  assert.equal(app.toggle().props['aria-expanded'], false)
  assert.equal(app.maybe('form', p => p.id === 'custom-weekbudget-form'), undefined)
  app.toggle().props.onClick()
  assert.equal(app.input().props.value, '', 'Cancelled draft must not return after reopening')
})

test('product #1424: invalid error is programmatically attached while present', () => {
  const app = page()
  app.toggle().props.onClick()
  assert.equal(app.input().props['aria-invalid'], undefined)
  assert.equal(app.input().props['aria-describedby'], 'custom-weekbudget-hint')
  app.edit('27,501')
  app.submit()
  assert.deepEqual(app.changes, [])
  assert.equal(app.input().props['aria-invalid'], true)
  assert.equal(app.input().props['aria-describedby'],
    'custom-weekbudget-hint custom-weekbudget-error')
  assert.equal(app.error().props.id, 'custom-weekbudget-error')
  assert.match(app.error().props.children, /maximaal twee decimalen/)
  app.edit('27,50')
  assert.equal(app.error(), undefined)
  assert.equal(app.input().props['aria-describedby'], 'custom-weekbudget-hint')
  app.submit()
  assert.deepEqual(app.changes, [27.5])
})

test('product #1424: cancel clears a failed submit without saving or leaving stale errors', () => {
  const app = page()
  app.toggle().props.onClick()
  app.edit('invalid')
  app.submit()
  assert.ok(app.error())
  app.cancel()
  assert.equal(app.toggle().props['aria-expanded'], false)
  assert.deepEqual(app.changes, [])
  app.toggle().props.onClick()
  assert.equal(app.input().props.value, '')
  assert.equal(app.error(), undefined)
  assert.equal(app.input().props['aria-invalid'], undefined)
})

test('product #1424: active saved custom budget survives a cancelled re-edit', () => {
  const app = page(27.5)
  assert.equal(app.toggle().props['aria-pressed'], true)
  app.toggle().props.onClick()
  assert.equal(app.input().props.value, '27,50')
  app.edit('99,99')
  app.cancel()
  assert.equal(app.props.budget, 27.5)
  assert.deepEqual(app.changes, [])
  app.toggle().props.onClick()
  assert.equal(app.input().props.value, '27,50')
})

test('product #1424: normal submit remains the sole way to commit a new custom budget', () => {
  const app = page()
  app.toggle().props.onClick()
  const buttons = app.find('form', p => p.id === 'custom-weekbudget-form')
  assert.equal(buttons.props.noValidate, true)
  assert.equal(app.find('button', p => p.children === 'Budget opslaan').props.type, 'submit')
  app.edit('42.75')
  app.submit()
  assert.deepEqual(app.changes, [42.75])
  assert.equal(app.props.budget, 42.75)
  assert.equal(app.toggle().props['aria-expanded'], false)
})
