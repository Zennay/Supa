import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { defaultPlannerPreferences, serializePlannerPreferences } from '../src/domain/plannerPreferences.ts'
import { restorePlannerPreferencesWithCustomBudget } from '../src/features/planner/customWeekBudget.ts'

// Independent executable acceptance for #1925, on frozen source-only #1927.
// All simulated storage records are synthetic; no personal, retailer or price data.
const nodeRequire = createRequire(import.meta.url)
const transpiled = ts.transpileModule(
  readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  { fileName: 'App.tsx', compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  }, reportDiagnostics: true },
)
assert.deepEqual(transpiled.diagnostics, [])
function flatten(tree) {
  if (Array.isArray(tree)) return tree.flatMap(flatten)
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return []
  return [tree, ...flatten(tree.props.children)]
}
const PlannerView = function PlannerView() {}
const BasketView = function BasketView() {}
const ShoppingListView = function ShoppingListView() {}
const ObservationView = function ObservationView() {}
function start(disk) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: disk } })
  const slots = []
  let index = 0
  let effects = []
  const depsEqual = (a, b) =>
    Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
    a.every((value, i) => Object.is(value, b[i]))
  const hooks = {
    useState(initial) {
      const n = index++
      if (!(n in slots)) slots[n] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[n].value, next => {
        slots[n].value = typeof next === 'function' ? next(slots[n].value) : next
      }]
    },
    useMemo(make, deps) {
      const n = index++
      if (!(n in slots) || !depsEqual(slots[n].deps, deps)) {
        slots[n] = { value: make(), deps }
      }
      return slots[n].value
    },
    useEffect(callback, deps) {
      const n = index++
      if (!(n in slots) || !depsEqual(slots[n].deps, deps)) {
        slots[n] = { deps }
        effects.push(callback)
      }
    },
  }
  const dependencies = id => {
    if (id === 'react') return hooks
    if (id === 'react/jsx-runtime') return nodeRequire(id)
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
    throw Error('unexpected App dependency: ' + id)
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', transpiled.outputText)(
    module, module.exports, dependencies,
  )
  function render() {
    index = 0
    effects = []
    const nodes = flatten(module.exports.App())
    effects.forEach(effect => effect())
    return nodes
  }
  function planner() {
    const element = render().find(node => node.type === PlannerView)
    assert.ok(element, 'planner must be routed')
    return element.props
  }
  function warning() {
    return String(render().find(node => node.type === 'p' && node.props.role === 'alert')?.props.children ?? '')
  }
  function navigate(label) {
    const element = render().find(node => node.type === 'button' && node.props.children === label)
    assert.ok(element, 'navigation must exist')
    element.props.onClick()
  }
  function close() {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete globalThis.window
  }
  return { render, planner, warning, navigate, close }
}

const key = 'supa:planner-preferences:v2'
function fakeDisk(initialRaw) {
  let raw = initialRaw
  let readBlocked = false
  let writeBlocked = false
  const writes = []
  return {
    get readBlocked() { return readBlocked },
    set readBlocked(value) { readBlocked = value },
    set writeBlocked(value) { writeBlocked = value },
    get raw() { return raw },
    set raw(value) { raw = value },
    writes,
    getItem(k) {
      assert.equal(k, key)
      if (readBlocked) throw Error('synthetic read refused')
      return raw
    },
    setItem(k, value) {
      assert.equal(k, key)
      if (writeBlocked) throw Error('synthetic write refused')
      raw = value
      writes.push(value)
    },
  }
}

test('product #1925 independent: future planner envelope keeps exact bytes across explicit edits', () => {
  const future = '{"schemaVersion":3,"budget":27.5,"opaque":{"version":"future"}}'
  const disk = fakeDisk(future)
  const app = start(disk)
  try {
    app.render()
    assert.equal(disk.raw, future)
    assert.equal(disk.writes.length, 0)
    assert.match(app.warning(), /eerdere opgeslagen gegevens/i)
    app.planner().onBudgetChange(42.75)
    assert.equal(app.planner().budget, 42.75)
    assert.equal(disk.raw, future)
    assert.match(app.warning(), /tijdelijk/i)
    disk.raw = null // simulated external removal; not an automatic reset
    app.planner().onBudgetChange(27.5)
    app.render()
    assert.equal(JSON.parse(disk.raw).budget, 27.5)
    assert.equal(app.warning(), '')
  } finally { app.close() }
})

test('product #1925 independent: recovered read cannot clobber an unseen existing budget', () => {
  const raw = serializePlannerPreferences({
    ...defaultPlannerPreferences(m2InitialPlan), budget: 27.5,
  })
  const disk = fakeDisk(raw)
  disk.readBlocked = true
  const app = start(disk)
  try {
    app.render()
    assert.equal(disk.writes.length, 0)
    assert.match(app.warning(), /tijdelijk/i)
    disk.readBlocked = false
    app.planner().onBudgetChange(40)
    app.render()
    assert.equal(disk.raw, raw)
    assert.equal(disk.writes.length, 0)
    assert.match(app.warning(), /eerdere opgeslagen gegevens/i)
  } finally { app.close() }
})

test('product #1925 independent: write denial stays visible across navigation until successful edit', () => {
  const disk = fakeDisk(null)
  disk.writeBlocked = true
  const app = start(disk)
  try {
    app.render()
    assert.match(app.warning(), /niet opgeslagen/i)
    app.planner().onBudgetChange(42.75)
    app.render()
    assert.equal(app.planner().budget, 42.75)
    app.navigate('Mand')
    app.render()
    assert.match(app.warning(), /niet opgeslagen/i)
    disk.writeBlocked = false
    app.navigate('Planner')
    app.planner().onBudgetChange(27.5)
    app.render()
    assert.equal(JSON.parse(disk.raw).budget, 27.5)
    assert.equal(app.warning(), '')
    assert.equal(disk.writes.length, 1)
  } finally { app.close() }
})

test('product #1925 independent: valid saved preference stays quiet and retains chosen day', () => {
  const initial = serializePlannerPreferences({
    ...defaultPlannerPreferences(m2InitialPlan), activeDays: ['Di'], budget: 42.75,
  })
  const disk = fakeDisk(initial)
  const app = start(disk)
  try {
    assert.equal(app.planner().budget, 42.75)
    assert.deepEqual(app.planner().activeDays, ['Di'])
    assert.equal(app.warning(), '')
    app.planner().onBudgetChange(27.5)
    app.render()
    assert.equal(JSON.parse(disk.raw).budget, 27.5)
    assert.deepEqual(JSON.parse(disk.raw).activeDays, ['Di'])
    assert.equal(app.warning(), '')
  } finally { app.close() }
})
