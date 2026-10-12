import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { defaultPlannerPreferences, serializePlannerPreferences } from '../src/domain/plannerPreferences.ts'
import { restorePlannerPreferencesWithCustomBudget } from '../src/features/planner/customWeekBudget.ts'

// #1925 expected RED: real compiled App effects against synthetic storage.
// No browser claims, no changes to App/Planner source, no retailer data.
const nativeRequire = createRequire(import.meta.url)
const compiled = ts.transpileModule(
  readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  { fileName: 'App.tsx', compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  }, reportDiagnostics: true },
)
assert.deepEqual(compiled.diagnostics, [])
const PlannerView = function PlannerView() {}
const BasketView = function BasketView() {}
const ShoppingListView = function ShoppingListView() {}
const ObservationView = function ObservationView() {}
function tree(node) {
  if (Array.isArray(node)) return node.flatMap(tree)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  return [node, ...tree(node.props.children)]
}
function mount(localStorage) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage }, configurable: true,
  })
  const slots = []
  let cursor = 0
  let effects = []
  const unchanged = (before, after) =>
    Array.isArray(before) && Array.isArray(after) &&
    before.length === after.length && before.every((x, i) => Object.is(x, after[i]))
  const react = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = { kind: 'state', value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, next => {
        slots[i].value = typeof next === 'function' ? next(slots[i].value) : next
      }]
    },
    useMemo(factory, deps) {
      const i = cursor++
      if (!(i in slots) || !unchanged(slots[i].deps, deps)) {
        slots[i] = { kind: 'memo', value: factory(), deps }
      }
      return slots[i].value
    },
    useEffect(callback, deps) {
      const i = cursor++
      if (!(i in slots) || !unchanged(slots[i].deps, deps)) {
        slots[i] = { kind: 'effect', deps }
        effects.push(callback)
      }
    },
  }
  const dependencies = id => {
    if (id === 'react') return react
    if (id === 'react/jsx-runtime') return nativeRequire(id)
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
    if (id === './data/m2Fixture') return {
      m2InitialPlan, m2Products, m2Recipes, m2Store,
    }
    if (id === './data/m3ComparisonFixture') return {
      m3BaselineProducts: [], m3BaselineStore: m2Store,
      m3CandidateProducts: [], m3CandidateStore: m2Store,
    }
    throw Error('unexpected import ' + id)
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, dependencies,
  )
  const render = () => {
    cursor = 0
    effects = []
    const nodes = tree(module.exports.App())
    for (const effect of effects) effect()
    return nodes
  }
  const planner = () => {
    const node = render().find(element => element.type === PlannerView)
    assert.ok(node, 'planner visible')
    return node.props
  }
  const alerts = () => render().filter(
    node => node.type === 'p' && node.props.role === 'alert',
  )
  const close = () => {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete globalThis.window
  }
  return { render, planner, alerts, close }
}

test('product #1925 expected RED: unreadable saved preferences must not be overwritten', () => {
  const disk = {
    writes: 0,
    getItem() { throw Error('synthetic read blocked') },
    setItem() { this.writes++ },
  }
  const app = mount(disk)
  try {
    app.render()
    assert.equal(disk.writes, 0, 'do not replace unknown records after a failed read')
    assert.match(String(app.alerts()[0]?.props.children), /tijdelijk|niet opgeslagen/i)
    app.planner().onBudgetChange(27.5)
    assert.equal(app.planner().budget, 27.5, 'session still usable')
    assert.equal(disk.writes, 0)
  } finally { app.close() }
})

test('product #1925 expected RED: failed write displays an announced unsaved warning', () => {
  const disk = {
    getItem() { return null },
    setItem() { throw Error('synthetic quota denial') },
  }
  const app = mount(disk)
  try {
    app.render()
    assert.match(String(app.alerts()[0]?.props.children), /tijdelijk|niet opgeslagen/i)
    app.planner().onBudgetChange(42.75)
    assert.equal(app.planner().budget, 42.75)
    assert.match(String(app.alerts()[0]?.props.children), /tijdelijk|niet opgeslagen/i)
  } finally { app.close() }
})

test('product #1925 control: working storage saves changed budget quietly', () => {
  const values = new Map()
  const disk = {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) },
  }
  const app = mount(disk)
  try {
    app.render()
    assert.deepEqual(app.alerts(), [])
    app.planner().onBudgetChange(27.5)
    assert.equal(app.planner().budget, 27.5)
    assert.equal(JSON.parse(values.get('supa:planner-preferences:v2')).budget, 27.5)
    assert.deepEqual(app.alerts(), [])
  } finally { app.close() }
})
