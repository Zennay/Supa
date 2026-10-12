import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { euro } from '../src/lib/money.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { RecipeEstimateDisclosure } from '../src/features/planner/RecipeEstimateDisclosure.ts'
import { parseCustomWeekBudgetCents, validCustomWeekBudgetEuros, restorePlannerPreferencesWithCustomBudget } from '../src/features/planner/customWeekBudget.ts'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { defaultPlannerPreferences, serializePlannerPreferences } from '../src/domain/plannerPreferences.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { m3BaselineProducts, m3BaselineStore, m3CandidateProducts, m3CandidateStore } from '../src/data/m3ComparisonFixture.ts'

// Independent *combined* App → PlannerView handler proof, using actual compiled
// modules, source fixtures and a deterministic hook/storage harness. This is
// not a real Firefox/browser hydration or multi-tab test.
const require = createRequire(import.meta.url)
const jsx = require('react/jsx-runtime')
const jsxDeps = { 'react/jsx-runtime': jsx }
function compile(path, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/^import\s+['"]\.\/planner\.css['"]\s*;?\s*$/m, '')
  const output = ts.transpileModule(source, {
    fileName: path.endsWith('App.tsx') ? 'App.tsx' : 'PlannerView.tsx',
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  })
  assert.deepEqual(output.diagnostics, [])
  const module = { exports: {} }
  new Function('module', 'exports', 'require', output.outputText)(
    module, module.exports, key => {
      assert.ok(Object.hasOwn(dependencies, key), 'Unexpected import ' + key)
      return dependencies[key]
    },
  )
  return module.exports
}
function hookState() {
  const slots = []
  let cursor = 0
  return {
    run(callback) { cursor = 0; return callback() },
    hooks: {
      useState(initial) {
        const i = cursor++
        if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
        return [slots[i], next => {
          slots[i] = typeof next === 'function' ? next(slots[i]) : next
        }]
      },
      useMemo(fn) { return fn() },
      useEffect(fn) { fn() },
    },
  }
}
function walk(element) {
  if (Array.isArray(element)) return element.flatMap(walk)
  if (!element || typeof element !== 'object' || !('props' in element)) return []
  return [element, ...walk(element.props.children)]
}
function mount() {
  const viewState = hookState()
  const appState = hookState()
  const PlannerView = compile('../src/features/planner/PlannerView.tsx', {
    ...jsxDeps,
    react: viewState.hooks,
    '../../lib/money': { euro },
    '../../lib/plannerBudgetCents.ts': { assessPlannerBudgetCents },
    './RecipeEstimateDisclosure.ts': { RecipeEstimateDisclosure },
    './customWeekBudget.ts': { parseCustomWeekBudgetCents, validCustomWeekBudgetEuros },
  }).PlannerView
  const App = compile('../src/App.tsx', {
    ...jsxDeps,
    react: appState.hooks,
    './features/planner/PlannerView': { PlannerView },
    './features/basket/BasketView': { BasketView() {} },
    './features/shopping-list/ShoppingListView': { ShoppingListView() {} },
    './features/observation/ObservationView': { ObservationView() {} },
    './domain/basket': { buildOneStoreBasket },
    './domain/basketComparison': { compareFullBaskets },
    './domain/plannerPreferences': { defaultPlannerPreferences, serializePlannerPreferences },
    './features/planner/customWeekBudget.ts': { restorePlannerPreferencesWithCustomBudget },
    './data/m2Fixture': { m2InitialPlan, m2Products, m2Recipes, m2Store },
    './data/m3ComparisonFixture': { m3BaselineProducts, m3BaselineStore, m3CandidateProducts, m3CandidateStore },
  }).App
  function props() {
    const node = walk(appState.run(() => App())).find(e => e.type === PlannerView)
    assert.ok(node, 'App has routed the real PlannerView')
    return node.props
  }
  function rows() {
    const current = props()
    return viewState.run(() => walk(PlannerView(current)))
  }
  const maybe = (type, predicate) => rows().find(e => e.type === type && predicate(e.props))
  const find = (type, predicate) => {
    const result = maybe(type, predicate)
    assert.ok(result, 'Expected ' + String(type))
    return result
  }
  const toggle = () => find('button', p => p['aria-controls'] === 'custom-weekbudget-form')
  const input = () => find('input', p => p.id === 'custom-weekbudget-value')
  const submit = () => {
    let prevented = false
    find('form', p => p.id === 'custom-weekbudget-form').props.onSubmit({
      preventDefault() { prevented = true },
    })
    assert.equal(prevented, true)
  }
  return { props, rows, find, maybe, toggle, input, submit }
}
const KEY = 'supa:planner-preferences:v2'
const LEGACY = 'supa:planner-preferences:v1'
function storage(policy = {}) {
  const entries = new Map([[LEGACY, 'legacy-original-bytes']])
  const reads = [], writes = []
  return {
    entries, reads, writes,
    getItem(key) {
      reads.push(key)
      if (policy.denyRead) throw new Error('blocked read')
      return entries.get(key) ?? null
    },
    setItem(key, value) {
      writes.push(key)
      if (policy.denyWrite) throw new Error('blocked write')
      entries.set(key, value)
    },
  }
}
function withWindow(disk, fn) {
  const prior = globalThis.window
  globalThis.window = { localStorage: disk }
  try { return fn() } finally {
    if (prior === undefined) delete globalThis.window
    else globalThis.window = prior
  }
}

test('QA #1424: actual routed App + Planner preset, custom submit, and Reset preserve v2 and never revive stale form', () => {
  const disk = storage()
  withWindow(disk, () => {
    const ui = mount()
    assert.equal(ui.props().budget, 35)
    ui.toggle().props.onClick()
    ui.input().props.onChange({ target: { value: '27,501' } })
    ui.submit()
    assert.ok(ui.maybe('p', p => p.role === 'alert'))
    ui.find('button', p => p.type === 'button' && p.children === euro.format(40)).props.onClick()
    assert.equal(ui.props().budget, 40)
    assert.equal(ui.toggle().props['aria-expanded'], false)
    assert.equal(ui.maybe('form', p => p.id === 'custom-weekbudget-form'), undefined)
    assert.equal(JSON.parse(disk.entries.get(KEY)).budget, 40)

    ui.toggle().props.onClick()
    assert.equal(ui.input().props.value, '')
    assert.equal(ui.maybe('p', p => p.role === 'alert'), undefined)
    ui.input().props.onChange({ target: { value: '27,50' } })
    ui.submit()
    assert.equal(ui.props().budget, 27.5)
    assert.equal(ui.toggle().props['aria-expanded'], false)
    assert.equal(JSON.parse(disk.entries.get(KEY)).budget, 27.5)

    ui.toggle().props.onClick()
    assert.equal(ui.input().props.value, '27,50', 'current saved custom budget pre-fills instead of stale invalid draft')
    ui.input().props.onChange({ target: { value: '9999,99' } })
    ui.submit()
    assert.ok(ui.maybe('p', p => p.role === 'alert'))
    ui.find('button', p => p.children === 'Reset').props.onClick()
    assert.equal(ui.props().budget, 35)
    assert.equal(ui.toggle().props['aria-expanded'], false)
    assert.equal(ui.maybe('form', p => p.id === 'custom-weekbudget-form'), undefined)
    assert.equal(JSON.parse(disk.entries.get(KEY)).budget, 35)
    assert.equal(mount().props().budget, 35, 'new mount restores reset state')
    assert.equal(disk.entries.get(LEGACY), 'legacy-original-bytes')
    assert.ok(disk.reads.every(key => key === KEY))
    assert.ok(disk.writes.every(key => key === KEY))
  })
})

test('QA #1424: storage write denial never causes stale custom draft to escape into another preference key', () => {
  const disk = storage({ denyWrite: true })
  withWindow(disk, () => {
    const ui = mount()
    ui.toggle().props.onClick()
    ui.input().props.onChange({ target: { value: '9999,99' } })
    ui.submit()
    ui.find('button', p => p.type === 'button' && p.children === euro.format(30)).props.onClick()
    assert.equal(ui.props().budget, 30, 'in-memory preference stays usable')
    assert.equal(ui.toggle().props['aria-expanded'], false)
    assert.equal(ui.maybe('p', p => p.role === 'alert'), undefined)
    assert.equal(disk.entries.has(KEY), false, 'privacy-denied writes never materialize')
    assert.equal(disk.entries.get(LEGACY), 'legacy-original-bytes')
    assert.ok(disk.writes.every(key => key === KEY))
  })
})
