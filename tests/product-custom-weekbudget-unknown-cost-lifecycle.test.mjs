import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { euro } from '../src/lib/money.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { RecipeEstimateDisclosure } from '../src/features/planner/RecipeEstimateDisclosure.ts'
import { parseCustomWeekBudgetCents, validCustomWeekBudgetEuros } from '../src/features/planner/customWeekBudget.ts'

// Open product #1424: controlled renderer of the actual compiled Planner TSX.
// No observed prices, beta session, hydrated Firefox or retailer permission.
const nativeRequire = createRequire(import.meta.url)
const source = readFileSync(
  new URL('../src/features/planner/PlannerView.tsx', import.meta.url), 'utf8',
).replace(/^import\s+['"]\.\/planner\.css['"]\s*;?\s*$/m, '')
const compiled = ts.transpileModule(source, {
  fileName: 'PlannerView.tsx',
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])
function allNodes(node) {
  if (Array.isArray(node)) return node.flatMap(allNodes)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  return [node, ...allNodes(node.props.children)]
}
function planner(initialCostCents = 1969, unresolved = 2) {
  let cursor = 0
  const slots = []
  const budgets = []
  const props = {
    budget: 35, activeDays: [], plannedMeals: [], recipes: [],
    basketTotalCents: initialCostCents, basketUnresolvedLineCount: unresolved,
    onBudgetChange(amount) { budgets.push(amount); props.budget = amount },
    onToggleDay() {}, onRecipeChange() {}, onReset() {},
  }
  const imports = name => {
    if (name === 'react') return {
      useState(initial) {
        const i = cursor++
        if (!(i in slots)) slots[i] = initial
        return [slots[i], next => {
          slots[i] = typeof next === 'function' ? next(slots[i]) : next
        }]
      },
    }
    if (name === 'react/jsx-runtime') return nativeRequire(name)
    if (name === '../../lib/money') return { euro }
    if (name === '../../lib/plannerBudgetCents.ts') return { assessPlannerBudgetCents }
    if (name === './RecipeEstimateDisclosure.ts') return { RecipeEstimateDisclosure }
    if (name === './customWeekBudget.ts') return {
      parseCustomWeekBudgetCents, validCustomWeekBudgetEuros,
    }
    throw Error('unrecognized Planner import ' + name)
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(module, module.exports, imports)
  const nodes = () => {
    cursor = 0
    return allNodes(module.exports.PlannerView(props))
  }
  const find = (type, matches) => {
    const node = nodes().find(n => n.type === type && matches(n.props))
    assert.ok(node, 'Expected element ' + type)
    return node
  }
  const editBudget = text => {
    find('button', p => p['aria-controls'] === 'custom-weekbudget-form').props.onClick()
    find('input', p => p.id === 'custom-weekbudget-value').props.onChange({ target: { value: text } })
    let preventCount = 0
    find('form', p => p.id === 'custom-weekbudget-form').props.onSubmit({
      preventDefault() { preventCount++ },
    })
    assert.equal(preventCount, 1)
  }
  const summary = () => ({
    status: find('span', p => typeof p.className === 'string' && p.className.startsWith('budget-status')).props.children,
    cost: find('div', p => p.className === 'budget-summary').props.children,
    progress: find('div', p => p.role === 'progressbar').props,
    disclaimer: find('p', p => p.className === 'disclaimer' && allNodes(p.children).some(n => n.type === Symbol.for('react.fragment'))).props.children,
  })
  return { props, budgets, nodes, find, editBudget, summary }
}

test('product #1424: custom cent budget never promotes unresolved basket minimum to an under/over claim', () => {
  const page = planner(1969, 2)
  page.editBudget('27,50')
  assert.deepEqual(page.budgets, [27.5])
  assert.equal(page.props.budget, 27.5)
  let state = page.summary()
  assert.equal(state.status, '2 mandregels open')
  assert.equal(state.progress['aria-label'], 'Bekend minimum van het weekbudget')
  assert.equal(state.progress['aria-valuemax'], 27.5)
  assert.ok(page.nodes().some(n => n.type === 'strong' && n.props.children === 'min. € 19,69') ||
            page.nodes().some(n => n.type === 'strong' && String(n.props.children).startsWith('min. ') &&
              String(n.props.children).includes('19,69')))

  // Matching changes only the evidence status: do not mutate the budget.
  page.props.basketUnresolvedLineCount = 0
  page.props.basketTotalCents = 2751
  state = page.summary()
  assert.equal(state.status, euro.formatCents(1) + ' boven budget')
  assert.equal(state.progress['aria-label'], 'Gepland deel van het weekbudget')
  assert.equal(state.progress['aria-valuemax'], 27.5)
  assert.equal(page.props.budget, 27.5)
  assert.deepEqual(page.budgets, [27.5])

  // Losing the match again must remove the monetary comparison immediately.
  page.props.basketUnresolvedLineCount = 1
  state = page.summary()
  assert.equal(state.status, '1 mandregel open')
  assert.equal(state.progress['aria-label'], 'Bekend minimum van het weekbudget')
})

test('product #1424: advertised grouped €1.000,00 ceiling yields a one-cent over-budget result', () => {
  const page = planner(100001, 0)
  page.editBudget('1.000,00')
  assert.deepEqual(page.budgets, [1000])
  assert.equal(page.props.budget, 1000)
  const state = page.summary()
  assert.equal(state.status, euro.formatCents(1) + ' boven budget')
  assert.equal(state.progress['aria-valuemax'], 1000)
  assert.equal(state.progress['aria-valuenow'], 1000)
  assert.equal(page.find('strong', p => p.id === 'weekbudget-title').props.children, euro.format(1000))
})
