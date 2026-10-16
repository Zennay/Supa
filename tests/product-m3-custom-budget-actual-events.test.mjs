import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import React from 'react'
import ts from 'typescript'

import { euro } from '../src/lib/money.ts'
import { assessPlannerBudget, getBudgetState } from '../src/domain/planner.ts'
import { plannerKnownMinimumOverrunCents } from '../src/features/planner/plannerKnownMinimumOverrun.ts'
import { parseCustomWeekBudgetCents, validCustomWeekBudgetEuros } from '../src/features/planner/customWeekBudget.ts'

// Isolated synchronous model of React's three local useState slots.
// Calls the *actual compiled PlannerView event handlers*, without browser
// persistence or a claim of Firefox/mobile acceptance.
const require = createRequire(import.meta.url)
const code = readFileSync(new URL('../src/features/planner/PlannerView.tsx', import.meta.url), 'utf8')
  .replace(/^import\s+['"]\.\/planner\.css['"]\s*;?\s*$/m, '')
const result = ts.transpileModule(code, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'PlannerView.tsx',
  reportDiagnostics: true,
})
assert.deepEqual(result.diagnostics, [])

function harness() {
  const slots = []
  const changes = []
  let cursor = 0
  const useState = (initial) => {
    const slot = cursor++
    if (!(slot in slots)) slots[slot] = initial
    return [slots[slot], (next) => {
      slots[slot] = typeof next === 'function' ? next(slots[slot]) : next
    }]
  }
  const imports = (name) => {
    if (name === 'react') return { useState }
    if (name === './HiFiPlannerWeekCard.tsx') return { HiFiPlannerWeekCard: () => null }
    if (name === 'react/jsx-runtime') return require(name)
    if (name === '../../lib/money') return { euro }
    if (name === '../../domain/planner') return { assessPlannerBudget, getBudgetState }
    if (name === './RecipePriceExplanation') return { RecipePriceExplanation: () => null }
    if (name === './plannerKnownMinimumOverrun.ts') return { plannerKnownMinimumOverrunCents }
    if (name === '../../domain/ingredientReuse.ts') return { buildIngredientReuseInsight: () => null }
    if (name === './IngredientReuseCard.tsx') return { IngredientReuseCard: () => null }
    if (name === './RecipeReusePreviewPanel.tsx') return { RecipeReusePreviewPanel: () => null }
    if (name === './customWeekBudget.ts') return { parseCustomWeekBudgetCents, validCustomWeekBudgetEuros }
    throw new Error('Unexpected PlannerView dependency: ' + name)
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', result.outputText)(module, module.exports, imports)

  const props = {
    budget: 35,
    activeDays: [],
    plannedMeals: [],
    recipes: [],
    basketTotalCents: 1969,
    basketUnresolvedLineCount: 0,
    onBudgetChange: value => changes.push(value),
    onToggleDay() {},
    onRecipeChange() {},
    onReset() {},
  }
  function nodes(element) {
    if (Array.isArray(element)) return element.flatMap(nodes)
    if (element === null || typeof element !== 'object' || !('props' in element)) return []
    return [element, ...nodes(element.props.children)]
  }
  function render() {
    cursor = 0
    return nodes(module.exports.PlannerView(props))
  }
  function find(type, predicate = () => true) {
    const node = render().find(element => element.type === type && predicate(element.props))
    assert.ok(node, 'Expected ' + String(type))
    return node
  }
  function open() {
    find('button', props => props['aria-controls'] === 'custom-weekbudget-form').props.onClick()
    return find('form', props => props.id === 'custom-weekbudget-form')
  }
  function enter(value) {
    find('input', props => props.id === 'custom-weekbudget-value').props.onChange({ target: { value } })
  }
  function submit() {
    let prevented = false
    find('form', props => props.id === 'custom-weekbudget-form').props.onSubmit({
      preventDefault() { prevented = true },
    })
    assert.equal(prevented, true, 'Custom form must prevent browser navigation')
  }
  return { changes, find, render, open, enter, submit }
}

test('main integration #1424: opening and typing a Dutch budget never changes budget without submit', () => {
  const page = harness()
  const toggler = page.find('button', props => props['aria-controls'] === 'custom-weekbudget-form')
  assert.equal(toggler.props['aria-expanded'], false)
  assert.deepEqual(page.changes, [])
  page.open()
  page.enter('27,50')
  assert.deepEqual(page.changes, [])
  assert.equal(page.find('input', props => props.id === 'custom-weekbudget-value').props.value, '27,50')
  page.submit()
  assert.deepEqual(page.changes, [27.5])
  assert.equal(page.find('button', props => props['aria-controls'] === 'custom-weekbudget-form').props['aria-expanded'], false)
})

test('main integration #1424: invalid and sub-cent submit stays open with accessible error, then valid retry succeeds', () => {
  const page = harness()
  page.open()
  for (const bad of ['27,501', '0', '-2', '1000,01']) {
    page.enter(bad)
    page.submit()
    assert.deepEqual(page.changes, [], 'Invalid amount must never change budget')
    assert.equal(page.find('input', props => props.id === 'custom-weekbudget-value').props['aria-invalid'], true)
    assert.match(page.find('p', props => props.role === 'alert').props.children, /maximaal twee decimalen/)
  }
  page.enter('42.75')
  assert.equal(page.find('input', props => props.id === 'custom-weekbudget-value').props['aria-invalid'], undefined)
  page.submit()
  assert.deepEqual(page.changes, [42.75])
})

test('main integration #1424: old fixed budget chips remain direct non-submit actions', () => {
  const page = harness()
  const fixed = page.find('button', props => props['aria-pressed'] === true && props.type === 'button')
  assert.ok(fixed)
  assert.deepEqual(page.changes, [])
  const forty = page.find('button', props =>
    props.type === 'button' && props['aria-pressed'] === false && props.children === '€ 40,00')
  forty.props.onClick()
  assert.deepEqual(page.changes, [40])
})
