import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import {
  defaultPlannerPreferences,
  serializePlannerPreferences,
} from '../src/domain/plannerPreferences.ts'
import { restorePlannerPreferencesWithCustomBudget, parseCustomWeekBudgetCents, validCustomWeekBudgetEuros } from '../src/features/planner/customWeekBudget.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { euro } from '../src/lib/money.ts'
import { RecipeEstimateDisclosure } from '../src/features/planner/RecipeEstimateDisclosure.ts'

// Product #1424: execute both real compiled TSX functions with a shared,
// synchronous hook model. Exercises App -> PlannerView -> input/submit ->
// App persistence -> navigation/reload. Controlled M2 prices and fake storage;
// never substitute for browser hydration or genuine retail observations.
const require = createRequire(import.meta.url)
function compile(path, name) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/^import\s+['"]\.\/planner\.css['"]\s*;?\s*$/m, '')
  const compiled = ts.transpileModule(source, {
    fileName: name,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  })
  assert.deepEqual(compiled.diagnostics, [])
  return compiled.outputText
}
const appCode = compile('../src/App.tsx', 'App.tsx')
const plannerCode = compile('../src/features/planner/PlannerView.tsx', 'PlannerView.tsx')
const key = 'supa:planner-preferences:v2'
function children(node) {
  if (Array.isArray(node)) return node.flatMap(children)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  return [node, ...children(node.props.children)]
}
function storage(initial = null) {
  const values = new Map(initial === null ? [] : [[key, initial]])
  let writes = 0
  return {
    getItem(k) { return values.get(k) ?? null },
    setItem(k, v) { writes++; values.set(k, v) },
    get writes() { return writes },
    saved() { return JSON.parse(values.get(key)) },
  }
}
function mount(browserStore) {
  const state = []
  let index = 0
  let callbacks = []
  const react = {
    useState(initial) {
      const slot = index++
      if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial
      return [state[slot], change => {
        state[slot] = typeof change === 'function' ? change(state[slot]) : change
      }]
    },
    useMemo(calculate) { return calculate() },
    useEffect(callback) { callbacks.push(callback) },
  }
  const plannerModule = { exports: {} }
  const plannerDeps = id => {
    if (id === 'react') return react
    if (id === 'react/jsx-runtime') return require(id)
    if (id === '../../lib/money') return { euro }
    if (id === '../../lib/plannerBudgetCents.ts') return { assessPlannerBudgetCents }
    if (id === './RecipeEstimateDisclosure.ts') return { RecipeEstimateDisclosure }
    if (id === './customWeekBudget.ts') return { parseCustomWeekBudgetCents, validCustomWeekBudgetEuros }
    throw new Error('Unrecognized Planner dependency: ' + id)
  }
  new Function('module', 'exports', 'require', plannerCode)(
    plannerModule, plannerModule.exports, plannerDeps,
  )
  const PlannerView = plannerModule.exports.PlannerView
  const BasketView = function BasketView() {}
  const ShoppingListView = function ShoppingListView() {}
  const ObservationView = function ObservationView() {}
  const appModule = { exports: {} }
  const appDeps = id => {
    if (id === 'react') return react
    if (id === 'react/jsx-runtime') return require(id)
    if (id === './features/planner/PlannerView') return { PlannerView }
    if (id === './features/basket/BasketView') return { BasketView }
    if (id === './features/shopping-list/ShoppingListView') return { ShoppingListView }
    if (id === './features/observation/ObservationView') return { ObservationView }
    if (id === './domain/basket') return {
      buildOneStoreBasket: () => ({ totalCents: 1969, unresolvedLineCount: 0, lines: [] }),
    }
    if (id === './domain/basketComparison') return { compareFullBaskets: () => ({}) }
    if (id === './domain/plannerPreferences') return {
      defaultPlannerPreferences, serializePlannerPreferences,
    }
    if (id === './features/planner/customWeekBudget.ts') return {
      restorePlannerPreferencesWithCustomBudget,
    }
    if (id === './data/m2Fixture') return { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store }
    if (id === './data/m3ComparisonFixture') return {
      m3BaselineProducts: [], m3BaselineStore: m2Store,
      m3CandidateProducts: [], m3CandidateStore: m2Store,
    }
    throw new Error('Unrecognized App dependency: ' + id)
  }
  new Function('module', 'exports', 'require', appCode)(
    appModule, appModule.exports, appDeps,
  )
  function render() {
    index = 0
    callbacks = []
    const app = children(appModule.exports.App())
    const plannerElement = app.find(element => element.type === PlannerView)
    const all = plannerElement ? [...app, ...children(PlannerView(plannerElement.props))] : app
    callbacks.forEach(effect => effect())
    return all
  }
  function find(type, predicate) {
    const found = render().find(item => item.type === type && predicate(item.props))
    assert.ok(found, 'Expected ' + String(type))
    return found
  }
  function navigate(name) {
    find('button', p => p.children === name).props.onClick()
  }
  function openEditor() {
    find('button', p => p['aria-controls'] === 'custom-weekbudget-form').props.onClick()
  }
  function typeAmount(value) {
    find('input', p => p.id === 'custom-weekbudget-value').props.onChange({ target: { value } })
  }
  function submit() {
    let prevented = 0
    find('form', p => p.id === 'custom-weekbudget-form').props.onSubmit({
      preventDefault() { prevented++ },
    })
    assert.equal(prevented, 1)
  }
  return { render, find, navigate, openEditor, typeAmount, submit, browserStore }
}
function withWindow(browserStore, callback) {
  const previous = globalThis.window
  try {
    globalThis.window = { localStorage: browserStore }
    return callback()
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
}

test('product #1424 integrated: actual input submits custom cents into App storage, then survives navigation and reload', () => {
  const disk = storage()
  withWindow(disk, () => {
    const session = mount(disk)
    assert.equal(session.find('strong', p => p.id === 'weekbudget-title').props.children, euro.format(35))
    session.openEditor()
    session.typeAmount('27,50')
    // Typing is not a budget commit, even if React re-renders.
    assert.equal(disk.saved().budget, 35)
    assert.equal(session.find('input', p => p.id === 'custom-weekbudget-value').props.value, '27,50')
    session.submit()
    assert.equal(session.find('strong', p => p.id === 'weekbudget-title').props.children, euro.format(27.5))
    assert.equal(disk.saved().budget, 27.5)
    session.navigate('Mand')
    session.navigate('Planner')
    assert.equal(session.find('strong', p => p.id === 'weekbudget-title').props.children, euro.format(27.5))
    const nextSession = mount(disk)
    assert.equal(nextSession.find('strong', p => p.id === 'weekbudget-title').props.children, euro.format(27.5))
    nextSession.openEditor()
    assert.equal(nextSession.find('input', p => p.id === 'custom-weekbudget-value').props.value, '27,50')
  })
})

test('product #1424 integrated: rejected input and Cancel cannot mutate durable budget', () => {
  const original = serializePlannerPreferences({
    ...defaultPlannerPreferences(m2InitialPlan), budget: 42.75,
  })
  const disk = storage(original)
  withWindow(disk, () => {
    const page = mount(disk)
    assert.equal(page.find('strong', p => p.id === 'weekbudget-title').props.children, euro.format(42.75))
    page.openEditor()
    page.typeAmount('42,751')
    page.submit()
    assert.equal(page.find('input', p => p.id === 'custom-weekbudget-value').props['aria-invalid'], true)
    assert.equal(page.find('p', p => p.role === 'alert').props.id, 'custom-weekbudget-error')
    assert.equal(disk.saved().budget, 42.75)
    page.find('button', p => p.children === 'Annuleren').props.onClick()
    assert.equal(page.find('strong', p => p.id === 'weekbudget-title').props.children, euro.format(42.75))
    assert.equal(disk.saved().budget, 42.75)
    assert.equal(mount(disk).find('strong', p => p.id === 'weekbudget-title').props.children, euro.format(42.75))
  })
})

test('product #1424 integrated: formatted maximum is accepted, explicit reset returns stored default', () => {
  const disk = storage()
  withWindow(disk, () => {
    const page = mount(disk)
    page.openEditor()
    page.typeAmount('1.000,00')
    assert.equal(disk.saved().budget, 35)
    page.submit()
    assert.equal(disk.saved().budget, 1000)
    assert.equal(page.find('strong', p => p.id === 'weekbudget-title').props.children, euro.format(1000))
    page.find('button', p => p.children === 'Reset').props.onClick()
    assert.equal(disk.saved().budget, 35)
    assert.equal(mount(disk).find('strong', p => p.id === 'weekbudget-title').props.children, euro.format(35))
  })
})
