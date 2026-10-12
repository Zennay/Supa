import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { euro } from '../src/lib/money.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { RecipeEstimateDisclosure } from '../src/features/planner/RecipeEstimateDisclosure.ts'
import { parseCustomWeekBudgetCents, validCustomWeekBudgetEuros, restorePlannerPreferencesWithCustomBudget } from '../src/features/planner/customWeekBudget.ts'
import { defaultPlannerPreferences } from '../src/domain/plannerPreferences.ts'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'

// The actual TSX event handlers run with disposable synchronous React state.
// These controlled M2 facts are not browser hydration or genuine store prices.
const require = createRequire(import.meta.url)
const source = readFileSync(
  new URL('../src/features/planner/PlannerView.tsx', import.meta.url), 'utf8',
).replace(/^import\s+['"]\.\/planner\.css['"]\s*;?\s*$/m, '')
const compiled = ts.transpileModule(source, {
  fileName: 'PlannerView.tsx',
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])

function planner(initialBudget = 35) {
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
    if (name === './customWeekBudget.ts') return { parseCustomWeekBudgetCents, validCustomWeekBudgetEuros }
    throw Error('Unexpected PlannerView dependency: ' + name)
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(module, module.exports, imports)
  const props = {
    budget: initialBudget,
    activeDays: [], plannedMeals: [], recipes: [],
    basketTotalCents: 1969, basketUnresolvedLineCount: 0,
    onBudgetChange(budget) { changes.push(budget); props.budget = budget },
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
  const find = (type, predicate) => {
    const node = render().find(entry => entry.type === type && predicate(entry.props))
    assert.ok(node, 'Missing ' + type)
    return node
  }
  const toggle = () => find('button', p => p['aria-controls'] === 'custom-weekbudget-form')
  const open = () => toggle().props.onClick()
  const input = () => find('input', p => p.id === 'custom-weekbudget-value')
  const type = value => input().props.onChange({ target: { value } })
  const submit = () => {
    let prevented = false
    find('form', p => p.id === 'custom-weekbudget-form').props.onSubmit({
      preventDefault() { prevented = true },
    })
    assert.equal(prevented, true)
  }
  return { changes, props, toggle, open, input, type, submit, find }
}

test('product #1424: displayed grouped maximum submits exactly 100000 cents only after confirmation', () => {
  const page = planner()
  page.open()
  page.type(' 1.000,00 ')
  assert.deepEqual(page.changes, [], 'Typing must not auto-commit')
  assert.equal(page.input().props.value, ' 1.000,00 ')
  page.submit()
  assert.deepEqual(page.changes, [1000])
  assert.equal(page.props.budget, 1000)
  assert.equal(page.toggle().props['aria-expanded'], false)
  assert.equal(page.toggle().props['aria-pressed'], true)
  assert.match(page.toggle().props.children, /Eigen budget/)
  assert.equal(page.find('strong', p => p.id === 'weekbudget-title').props.children, euro.format(1000))
  assert.equal(page.find('span', p => p.className === 'budget-status').props.children, '€ 980,31 over')
})

test('product #1424: crossing the maximum, ambiguous grouping and subcent input never change saved selection', () => {
  const page = planner(27.5)
  page.open()
  assert.equal(page.input().props.value, '27,50')
  for (const invalid of ['1.000,01', '1.000', '1.000,000', '1,000.00']) {
    page.type(invalid)
    page.submit()
    assert.deepEqual(page.changes, [], invalid)
    assert.equal(page.props.budget, 27.5, invalid)
    assert.equal(page.input().props['aria-invalid'], true, invalid)
    assert.equal(page.input().props['aria-describedby'], 'custom-weekbudget-hint custom-weekbudget-error')
    assert.equal(page.find('p', p => p.role === 'alert').props.id, 'custom-weekbudget-error')
  }
  page.type('1.000,0')
  assert.equal(page.input().props['aria-invalid'], undefined)
  page.submit()
  assert.deepEqual(page.changes, [1000])
  assert.equal(page.props.budget, 1000)
})

test('product #1424: committed ceiling restores on a fresh planner and keeps 1000,00 as editable draft', () => {
  const first = planner()
  first.open()
  first.type('1.000,00')
  first.submit()
  const stored = JSON.stringify({
    ...defaultPlannerPreferences(m2InitialPlan),
    budget: first.props.budget,
  })
  const budget = restorePlannerPreferencesWithCustomBudget(
    stored, m2InitialPlan, m2Recipes.map(recipe => recipe.id),
  ).budget
  assert.equal(budget, 1000)
  const reopened = planner(budget)
  assert.equal(reopened.toggle().props['aria-pressed'], true)
  reopened.open()
  assert.equal(reopened.input().props.value, '1000,00')
  assert.deepEqual(reopened.changes, [])
  reopened.find('button', p => p.children === 'Annuleren').props.onClick()
  assert.equal(reopened.props.budget, 1000)
  assert.deepEqual(reopened.changes, [])
})
