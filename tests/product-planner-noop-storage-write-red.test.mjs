import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { defaultPlannerPreferences, serializePlannerPreferences } from '../src/domain/plannerPreferences.ts'
import { restorePlannerPreferencesWithCustomBudget } from '../src/features/planner/customWeekBudget.ts'

// Product-core #1925 synthetic expected-RED: invoke the COMPILED actual App
// hooks/effects with a deterministic localStorage double. Not a browser claim.
const transpiled = ts.transpileModule(
  readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  { fileName: 'App.tsx', compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  }, reportDiagnostics: true },
)
assert.deepEqual(transpiled.diagnostics, [])
const requireReal = createRequire(import.meta.url)
const PlannerView = () => null
const BasketView = () => null
const ShoppingListView = () => null
const ObservationView = () => null
const storageKey = 'supa:planner-preferences:v2'
const defaultRaw = serializePlannerPreferences(defaultPlannerPreferences(m2InitialPlan))

function flatten(node) {
  if (Array.isArray(node)) return node.flatMap(flatten)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  return [node, ...flatten(node.props.children)]
}

function mount({ initial = defaultRaw, writable = true } = {}) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let saved = initial
  let canWrite = writable
  const writes = []
  let reads = 0
  Object.defineProperty(globalThis, 'window', {
    configurable: true, value: { localStorage: {
      getItem(key) {
        assert.equal(key, storageKey)
        reads++
        return saved
      },
      setItem(key, value) {
        assert.equal(key, storageKey)
        writes.push(value)
        if (!canWrite) throw new Error('synthetic browser read-only storage')
        saved = value
      },
    } },
  })
  let cursor = 0
  let effects = []
  const state = []
  const sameDeps = (a, b) => Array.isArray(a) && Array.isArray(b) &&
    a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const react = {
    useState(initialValue) {
      const i = cursor++
      if (!(i in state)) state[i] = { value: typeof initialValue === 'function'
        ? initialValue() : initialValue }
      return [state[i].value, value => {
        state[i].value = typeof value === 'function' ? value(state[i].value) : value
      }]
    },
    useMemo(factory, deps) {
      const i = cursor++
      if (!(i in state) || !sameDeps(state[i].deps, deps)) {
        state[i] = { value: factory(), deps }
      }
      return state[i].value
    },
    useEffect(effect, deps) {
      const i = cursor++
      if (!(i in state) || !sameDeps(state[i].deps, deps)) {
        state[i] = { deps }
        effects.push(effect)
      }
    },
  }
  function load(name) {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return requireReal(name)
    if (name === './features/planner/PlannerView') return { PlannerView }
    if (name === './features/basket/BasketView') return { BasketView }
    if (name === './features/shopping-list/ShoppingListView') return { ShoppingListView }
    if (name === './features/observation/ObservationView') return { ObservationView }
    if (name === './domain/basket') return {
      buildOneStoreBasket: () => ({ totalCents: 1900, unresolvedLineCount: 0, lines: [] }),
    }
    if (name === './domain/basketComparison') return { compareFullBaskets: () => ({}) }
    if (name === './domain/plannerPreferences') return {
      defaultPlannerPreferences, serializePlannerPreferences,
    }
    if (name === './features/planner/customWeekBudget.ts') return {
      restorePlannerPreferencesWithCustomBudget,
    }
    if (name === './data/m2Fixture') return { m2InitialPlan, m2Products, m2Recipes, m2Store }
    if (name === './data/m3ComparisonFixture') return {
      m3BaselineProducts: [], m3BaselineStore: m2Store,
      m3CandidateProducts: [], m3CandidateStore: m2Store,
    }
    throw Error('unexpected actual App import: ' + name)
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', transpiled.outputText)(
    module, module.exports, load,
  )
  function render() {
    cursor = 0
    effects = []
    const nodes = flatten(module.exports.App())
    for (const effect of effects) effect()
    return nodes
  }
  function warning() {
    return render().find(node => node.type === 'p' && node.props.role === 'alert')
      ?.props.children ?? null
  }
  function planner() {
    const node = render().find(node => node.type === PlannerView)
    assert.ok(node)
    return node.props
  }
  return {
    render, warning, planner, writes,
    get raw() { return saved },
    get reads() { return reads },
    set writable(value) { canWrite = value },
    close() {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
      else delete globalThis.window
    },
  }
}

test('product #1925 expected RED: read-only storage with identical saved planner choices stays quiet', () => {
  const app = mount({ writable: false })
  try {
    app.render()
    assert.equal(app.raw, defaultRaw)
    assert.ok(app.reads >= 2, 'stored preferences were actually read')
    assert.equal(app.writes.length, 0, 'identical valid saved bytes need no write')
    assert.equal(app.warning(), null, 'saved choices must not be called unsaved')
  } finally { app.close() }
})

test('product #1925 expected RED: mounting an already durable valid plan performs zero redundant writes', () => {
  const app = mount()
  try {
    app.render()
    app.render()
    assert.equal(app.raw, defaultRaw)
    assert.equal(app.writes.length, 0)
    assert.equal(app.warning(), null)
  } finally { app.close() }
})

test('product #1925 control: deliberate changed cent-exact budget is persisted once', () => {
  const app = mount()
  try {
    app.render()
    app.planner().onBudgetChange(27.52)
    app.render()
    assert.equal(JSON.parse(app.raw).budget, 27.52)
    assert.equal(app.writes.filter(raw => JSON.parse(raw).budget === 27.52).length, 1)
    assert.equal(app.warning(), null)
  } finally { app.close() }
})
