import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { defaultPlannerPreferences, serializePlannerPreferences } from '../src/domain/plannerPreferences.ts'
import { restorePlannerPreferencesWithCustomBudget } from '../src/features/planner/customWeekBudget.ts'

// Independent product #1925 acceptance: execute compiled App effects and real
// planner handlers against isolated synthetic browser storage. No field prices.
const requireNode = createRequire(import.meta.url)
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: 'App.tsx',
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])
const key = 'supa:planner-preferences:v2'
function flatten(tree) {
  if (Array.isArray(tree)) return tree.flatMap(flatten)
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return []
  return [tree, ...flatten(tree.props.children)]
}
const PlannerView = () => null
const BasketView = () => null
const ShoppingListView = () => null
const ObservationView = () => null

function mount(initial) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let raw = initial
  const writes = []
  const storage = {
    getItem(name) {
      assert.equal(name, key)
      return raw
    },
    setItem(name, next) {
      assert.equal(name, key)
      raw = next
      writes.push(next)
    },
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true, value: { localStorage: storage },
  })
  const slots = []
  let index = 0
  let effects = []
  const equal = (a, b) =>
    Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
    a.every((v, i) => Object.is(v, b[i]))
  const react = {
    useState(initialState) {
      const n = index++
      if (!(n in slots)) slots[n] = { value: typeof initialState === 'function'
        ? initialState() : initialState }
      return [slots[n].value, next => {
        slots[n].value = typeof next === 'function' ? next(slots[n].value) : next
      }]
    },
    useMemo(fn, deps) {
      const n = index++
      if (!(n in slots) || !equal(slots[n].deps, deps)) {
        slots[n] = { value: fn(), deps }
      }
      return slots[n].value
    },
    useEffect(fn, deps) {
      const n = index++
      if (!(n in slots) || !equal(slots[n].deps, deps)) {
        slots[n] = { deps }
        effects.push(fn)
      }
    },
  }
  const load = name => {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return requireNode(name)
    if (name === './features/planner/PlannerView') return { PlannerView }
    if (name === './features/basket/BasketView') return { BasketView }
    if (name === './features/shopping-list/ShoppingListView') return { ShoppingListView }
    if (name === './features/observation/ObservationView') return { ObservationView }
    if (name === './domain/basket') return {
      buildOneStoreBasket: () => ({ totalCents: 1250, unresolvedLineCount: 0, lines: [] }),
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
    throw Error('unexpected dependency ' + name)
  }
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    mod, mod.exports, load,
  )
  const render = () => {
    index = 0
    effects = []
    const nodes = flatten(mod.exports.App())
    effects.forEach(effect => effect())
    return nodes
  }
  const planner = () => {
    const found = render().find(n => n.type === PlannerView)
    assert.ok(found, 'Planner must be routed')
    return found.props
  }
  const alert = () => String(render().find(n =>
    n.type === 'p' && n.props.role === 'alert')?.props.children ?? '')
  const close = () => {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
  }
  return { render, planner, alert, close, get raw() { return raw },
    set raw(v) { raw = v }, writes }
}
const saved = (changes = {}) => JSON.stringify({
  ...defaultPlannerPreferences(m2InitialPlan), ...changes,
})

test('product #1925: duplicate days preserve raw bytes across mount, toggle and reset', () => {
  const initial = saved({ activeDays: ['Di', 'Di'] })
  const app = mount(initial)
  try {
    app.render()
    assert.equal(app.raw, initial)
    assert.equal(app.writes.length, 0)
    assert.match(app.alert(), /tijdelijk|niet opgeslagen/i)
    app.planner().onToggleDay('Wo')
    app.render()
    assert.equal(app.raw, initial)
    assert.equal(app.writes.length, 0)
    app.planner().onReset()
    app.render()
    assert.equal(app.raw, initial, 'explicit reset must not erase protected saved bytes')
    assert.match(app.alert(), /eerdere opgeslagen gegevens/i)
  } finally { app.close() }
})

test('product #1925: noncanonical recipe identity preserves durable JSON while session edits work', () => {
  const initial = saved({ recipeByDay: { Di: ' ' } })
  const app = mount(initial)
  try {
    app.render()
    assert.equal(app.raw, initial)
    assert.equal(app.writes.length, 0)
    assert.match(app.alert(), /niet opgeslagen/i)
    app.planner().onBudgetChange(42.75)
    app.render()
    assert.equal(app.planner().budget, 42.75)
    assert.equal(app.raw, initial)
    assert.equal(app.writes.length, 0)
  } finally { app.close() }
})

test('product #1925: deliberate storage-key removal plus edit recovers and removes warning', () => {
  const app = mount(saved({ activeDays: ['Di', 'Di'] }))
  try {
    app.render()
    assert.match(app.alert(), /niet opgeslagen/i)
    app.raw = null
    assert.equal(app.writes.length, 0)
    app.planner().onBudgetChange(27.5)
    app.render()
    assert.equal(JSON.parse(app.raw).budget, 27.5)
    assert.equal(app.writes.length, 1)
    assert.equal(app.alert(), '')
  } finally { app.close() }
})

test('product #1925: valid cent-exact preferences remain quiet and writable', () => {
  const initial = saved({ budget: 0.01, activeDays: ['Di'] })
  const app = mount(initial)
  try {
    assert.equal(app.planner().budget, 0.01)
    assert.equal(app.alert(), '')
    app.planner().onBudgetChange(1000)
    app.render()
    assert.equal(JSON.parse(app.raw).budget, 1000)
    assert.deepEqual(JSON.parse(app.raw).activeDays, ['Di'])
    assert.equal(app.alert(), '')
  } finally { app.close() }
})
