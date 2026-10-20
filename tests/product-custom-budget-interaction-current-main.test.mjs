import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { euro } from '../src/lib/money.ts'
import { getBudgetState, assessPlannerBudget } from '../src/domain/planner.ts'
import { plannerKnownMinimumOverrunCents } from '../src/features/planner/plannerKnownMinimumOverrun.ts'
import { buildIngredientReuseInsight } from '../src/domain/ingredientReuse.ts'
import { parseCustomWeekBudgetCents, validCustomWeekBudgetEuros } from '../src/features/planner/customWeekBudget.ts'

const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../src/features/planner/PlannerView.tsx', import.meta.url), 'utf8')
  .replace(/^import\s+['"]\.\/planner\.css['"]\s*;?\s*$/m, '')
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'PlannerView.tsx',
  reportDiagnostics: true,
})
assert.deepEqual(transpiled.diagnostics, [])

function harness() {
  const slots = []
  const updates = []
  let cursor = 0
  const useState = (initial) => {
    const slot = cursor++
    if (!Object.hasOwn(slots, slot)) slots[slot] = initial
    return [slots[slot], (next) => {
      slots[slot] = typeof next === 'function' ? next(slots[slot]) : next
    }]
  }
  const modules = {
    react: { useState },
    './HiFiPlannerWeekCard.tsx': { HiFiPlannerWeekCard: () => null },
    'react/jsx-runtime': require('react/jsx-runtime'),
    '../../domain/planner': { assessPlannerBudget, getBudgetState },
    '../../domain/ingredientReuse.ts': { buildIngredientReuseInsight },
    '../../lib/money': { euro },
    './RecipePriceExplanation': { RecipePriceExplanation: () => null },
    './IngredientReuseCard.tsx': { IngredientReuseCard: () => null },
    './RecipeReusePreviewPanel.tsx': { RecipeReusePreviewPanel: () => null },
    './plannerKnownMinimumOverrun.ts': { plannerKnownMinimumOverrunCents },
    './customWeekBudget.ts': { parseCustomWeekBudgetCents, validCustomWeekBudgetEuros },
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', transpiled.outputText)(
    (id) => {
      assert.ok(Object.hasOwn(modules, id), 'Unexpected PlannerView dependency: ' + id)
      return modules[id]
    }, module, module.exports,
  )
  const props = {
    budget: 35,
    activeDays: [],
    plannedMeals: [],
    recipes: [],
    basketTotalCents: 1969,
    basketUnresolvedLineCount: 0,
    onBudgetChange(value) { updates.push(value) },
    onToggleDay() {},
    onRecipeChange() {},
    onReset() {},
  }

  function descendants(element) {
    if (Array.isArray(element)) return element.flatMap(descendants)
    if (!element || typeof element !== 'object' || !Object.hasOwn(element, 'props')) return []
    return [element, ...descendants(element.props.children)]
  }
  function render() {
    cursor = 0
    return descendants(module.exports.PlannerView(props))
  }
  function find(type, predicate = () => true) {
    const result = render().find((element) => element.type === type && predicate(element.props))
    assert.ok(result, 'Expected ' + String(type))
    return result
  }
  function openForm() {
    const toggle = find('button', (props) => props['aria-controls'] === 'custom-weekbudget-form')
    toggle.props.onClick()
    return find('form', (props) => props.id === 'custom-weekbudget-form')
  }
  function enter(value) {
    find('input', (props) => props.id === 'custom-weekbudget-value')
      .props.onChange({ target: { value } })
  }
  function submit() {
    let prevented = false
    find('form', (props) => props.id === 'custom-weekbudget-form')
      .props.onSubmit({ preventDefault() { prevented = true } })
    assert.equal(prevented, true)
  }

  return { updates, find, render, openForm, enter, submit }
}

test('actual live PlannerView requires explicit budget submit before persisting 27,50', () => {
  const ui = harness()
  assert.equal(ui.find('button', (p) => p['aria-controls'] === 'custom-weekbudget-form')
    .props['aria-expanded'], false)
  assert.deepEqual(ui.updates, [])
  ui.openForm()
  ui.enter('27,50')
  assert.deepEqual(ui.updates, [], 'Typing cannot change the saved budget')
  assert.equal(ui.find('input', (p) => p.id === 'custom-weekbudget-value').props.value, '27,50')
  ui.submit()
  assert.deepEqual(ui.updates, [27.5])
  assert.equal(ui.find('button', (p) => p['aria-controls'] === 'custom-weekbudget-form')
    .props['aria-expanded'], false)
})

test('invalid or sub-cent budgets stay unsaved with accessible errors; retry succeeds', () => {
  const ui = harness()
  ui.openForm()
  for (const invalid of ['27,501', '0', '-2', '1000,01', 'NaN']) {
    ui.enter(invalid)
    ui.submit()
    assert.deepEqual(ui.updates, [])
    assert.equal(ui.find('input', (p) => p.id === 'custom-weekbudget-value')
      .props['aria-invalid'], true)
    assert.match(ui.find('p', (p) => p.role === 'alert').props.children, /maximaal twee decimalen/)
  }
  ui.enter('42.75')
  assert.equal(ui.find('input', (p) => p.id === 'custom-weekbudget-value')
    .props['aria-invalid'], undefined)
  ui.submit()
  assert.deepEqual(ui.updates, [42.75])
})

test('normal fixed-price budget chips stay non-submit actions', () => {
  const ui = harness()
  const forty = ui.find('button', (p) => p.type === 'button' &&
    p['aria-pressed'] === false && typeof p.children === 'string' && p.children.replaceAll('\u00a0', ' ').replaceAll('\u202f', ' ') === '€ 40,00')
  forty.props.onClick()
  assert.deepEqual(ui.updates, [40])
})
