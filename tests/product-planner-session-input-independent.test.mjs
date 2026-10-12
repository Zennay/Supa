import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { defaultPlannerPreferences, serializePlannerPreferences } from '../src/domain/plannerPreferences.ts'
import { restorePlannerPreferencesWithCustomBudget } from '../src/features/planner/customWeekBudget.ts'

// #1925 invalid planner session input independent actual-App acceptance, review-only and synthetic storage.
const requireNode = createRequire(import.meta.url)
const built = ts.transpileModule(
  readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), {
    fileName: 'App.tsx', compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }, reportDiagnostics: true,
  },
)
assert.deepEqual(built.diagnostics, [])
const PlannerView = () => null
const BasketView = () => null
const ShoppingListView = () => null
const ObservationView = () => null
const key = 'supa:planner-preferences:v2'
const flat = element => Array.isArray(element) ? element.flatMap(flat)
  : !element || typeof element !== 'object' || !('props' in element) ? []
    : [element, ...flat(element.props.children)]

function mount(saved) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let raw = saved
  const writes = []
  const storage = {
    getItem(name) {
      assert.equal(name, key)
      return raw
    },
    setItem(name, value) {
      assert.equal(name, key)
      writes.push(value)
      raw = value
    },
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true, value: { localStorage: storage },
  })
  let pointer = 0
  let callbacks = []
  const slots = []
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) &&
    a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const react = {
    useState(initial) {
      const i = pointer++
      if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, next => {
        slots[i].value = typeof next === 'function' ? next(slots[i].value) : next
      }]
    },
    useMemo(fn, deps) {
      const i = pointer++
      if (!(i in slots) || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() }
      return slots[i].value
    },
    useEffect(fn, deps) {
      const i = pointer++
      if (!(i in slots) || !same(slots[i].deps, deps)) {
        slots[i] = { deps }
        callbacks.push(fn)
      }
    },
  }
  const requireApp = name => {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return requireNode(name)
    if (name === './features/planner/PlannerView') return { PlannerView }
    if (name === './features/basket/BasketView') return { BasketView }
    if (name === './features/shopping-list/ShoppingListView') return { ShoppingListView }
    if (name === './features/observation/ObservationView') return { ObservationView }
    if (name === './domain/basket') return {
      buildOneStoreBasket: () => ({ totalCents: 1969, unresolvedLineCount: 0, lines: [] }),
    }
    if (name === './domain/basketComparison') return { compareFullBaskets: () => ({}) }
    if (name === './domain/plannerPreferences') return {
      defaultPlannerPreferences, serializePlannerPreferences,
    }
    if (name === './features/planner/customWeekBudget.ts') return {
      restorePlannerPreferencesWithCustomBudget,
    }
    if (name === './data/m2Fixture') return {
      m2InitialPlan, m2Products, m2Recipes, m2Store,
    }
    if (name === './data/m3ComparisonFixture') return {
      m3BaselineProducts: [], m3BaselineStore: m2Store,
      m3CandidateProducts: [], m3CandidateStore: m2Store,
    }
    throw Error('Unexpected App dependency: ' + name)
  }
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', built.outputText)(mod, mod.exports, requireApp)
  function render() {
    pointer = 0
    callbacks = []
    const result = flat(mod.exports.App())
    for (const effect of callbacks) effect()
    return result
  }
  function planner() {
    const item = render().find(n => n.type === PlannerView)
    assert.ok(item, 'Planner routed')
    return item.props
  }
  function alert() {
    return String(render().find(n => n.type === 'p' && n.props.role === 'alert')
      ?.props.children ?? '')
  }
  function close() {
    if (prior) Object.defineProperty(globalThis, 'window', prior)
    else delete globalThis.window
  }
  return { render, planner, alert, close, writes,
    get raw() { return raw }, set raw(value) { raw = value } }
}
const record = (days, entries) => JSON.stringify({
  ...defaultPlannerPreferences(m2InitialPlan),
  activeDays: days,
  recipeByDay: Object.fromEntries(entries),
})








test('product #1925 independent: malformed budgets never poison an existing stored week', () => {
  const saved = record(['Di'], [['Di', 'teriyaki']])
  const app = mount(saved)
  try {
    app.render()
    // A valid sparse saved v2 map is intentionally normalized on mount.
    // Assert the invalid callbacks do not alter the mounted baseline.
    const mounted = app.raw
    const before = app.writes.length
    for (const bad of [-1, 0, 0.001, 27.501, 1000.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      app.planner().onBudgetChange(bad)
      app.render()
      assert.equal(app.raw, mounted)
      assert.equal(app.planner().budget, 35)
      assert.equal(app.writes.length, before)
    }
    assert.equal(app.alert(), '')
  } finally { app.close() }
})

test('product #1925 independent: unknown days and recipe IDs cannot create a corrupt durable record', () => {
  const saved = record(['Di'], [['Di', 'teriyaki']])
  const app = mount(saved)
  try {
    app.render()
    // A valid sparse saved v2 map is intentionally normalized on mount.
    // Assert the invalid callbacks do not alter the mounted baseline.
    const mounted = app.raw
    const before = app.writes.length
    for (const action of [
      props => props.onToggleDay('Za'),
      props => props.onToggleDay('__proto__'),
      props => props.onRecipeChange('Di', 'future-recipe'),
      props => props.onRecipeChange('Za', 'tikka'),
    ]) {
      action(app.planner())
      app.render()
      assert.equal(app.raw, mounted)
      assert.equal(app.writes.length, before)
    }
    app.planner().onRecipeChange('Di', 'pasta')
    app.render()
    assert.equal(JSON.parse(app.raw).recipeByDay.Di, 'pasta')
    assert.equal(app.alert(), '')
  } finally { app.close() }
})

test('product #1925 independent: cent boundary values, valid day and reset stay usable', () => {
  const app = mount(record(['Di'], [['Di', 'teriyaki']]))
  try {
    app.render()
    for (const budget of [0.01, 27.5, 42.75, 1000]) {
      app.planner().onBudgetChange(budget)
      app.render()
      assert.equal(JSON.parse(app.raw).budget, budget)
    }
    app.planner().onToggleDay('Ma')
    app.render()
    assert.deepEqual(JSON.parse(app.raw).activeDays, ['Di', 'Ma'])
    app.planner().onReset()
    app.render()
    assert.equal(JSON.parse(app.raw).budget, 35)
    assert.equal(app.alert(), '')
  } finally { app.close() }
})
