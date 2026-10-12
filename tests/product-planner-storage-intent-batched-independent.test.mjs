import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { defaultPlannerPreferences, serializePlannerPreferences } from '../src/domain/plannerPreferences.ts'
import { restorePlannerPreferencesWithCustomBudget } from '../src/features/planner/customWeekBudget.ts'

// Independent #1925 actual-compiled App.tsx lifecycle: only controlled M2
// fixtures and fake browser storage. Review-only; no hydration/retailer claims.
const nativeRequire = createRequire(import.meta.url)
const transpiled = ts.transpileModule(
  readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), {
    fileName: 'App.tsx', compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }, reportDiagnostics: true,
  },
)
assert.deepEqual(transpiled.diagnostics, [])
const PlannerView = function PlannerView() {}
const BasketView = function BasketView() {}
const ShoppingListView = function ShoppingListView() {}
const ObservationView = function ObservationView() {}
const key = 'supa:planner-preferences:v2'
const defaultRaw = serializePlannerPreferences(defaultPlannerPreferences(m2InitialPlan))
function flatten(node) {
  if (Array.isArray(node)) return node.flatMap(flatten)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  return [node, ...flatten(node.props.children)]
}
function mount({ denyWrite = false } = {}) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let saved = defaultRaw
  let writeDenied = denyWrite
  const writes = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true, value: { localStorage: {
      getItem(name) {
        assert.equal(name, key)
        return saved
      },
      setItem(name, value) {
        assert.equal(name, key)
        if (writeDenied) throw Error('synthetic private-mode write denial')
        saved = value
        writes.push(value)
      },
    } },
  })
  const slots = []
  let cursor = 0
  let effects = []
  const equalDeps = (a, b) =>
    Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
    a.every((item, i) => Object.is(item, b[i]))
  const react = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) {
        slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      }
      return [slots[i].value, next => {
        slots[i].value = typeof next === 'function' ? next(slots[i].value) : next
      }]
    },
    useMemo(fn, deps) {
      const i = cursor++
      if (!(i in slots) || !equalDeps(slots[i].deps, deps)) {
        slots[i] = { value: fn(), deps }
      }
      return slots[i].value
    },
    useEffect(fn, deps) {
      const i = cursor++
      if (!(i in slots) || !equalDeps(slots[i].deps, deps)) {
        slots[i] = { deps }
        effects.push(fn)
      }
    },
  }
  const imports = name => {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return nativeRequire(name)
    if (name === './features/planner/PlannerView') return { PlannerView }
    if (name === './features/basket/BasketView') return { BasketView }
    if (name === './features/shopping-list/ShoppingListView') return { ShoppingListView }
    if (name === './features/observation/ObservationView') return { ObservationView }
    if (name === './domain/basket') return {
      buildOneStoreBasket: () => ({ totalCents: 2000, unresolvedLineCount: 0, lines: [] }),
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
    throw Error('unexpected compiled App import: ' + name)
  }
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', transpiled.outputText)(
    mod, mod.exports, imports,
  )
  function render() {
    cursor = 0
    effects = []
    const nodes = flatten(mod.exports.App())
    for (const effect of [...effects]) effect()
    return nodes
  }
  return {
    render,
    planner() {
      const item = render().find(n => n.type === PlannerView)
      assert.ok(item, 'planner route must be available')
      return item.props
    },
    get alert() {
      return String(render().find(n => n.type === 'p' && n.props.role === 'alert')?.props.children ?? '')
    },
    nav(label) {
      const button = render().find(n => n.type === 'button' && n.props.children === label)
      assert.ok(button, 'navigation button ' + label)
      button.props.onClick()
    },
    get raw() { return saved },
    set raw(value) { saved = value },
    set denyWrite(value) { writeDenied = value },
    writes,
    close() {
      if (prior) Object.defineProperty(globalThis, 'window', prior)
      else delete globalThis.window
    },
  }
}

test('product #1925: passive navigation cannot retry failed planner write or clear warning', () => {
  const app = mount({ denyWrite: true })
  try {
    app.render()
    assert.equal(app.raw, defaultRaw)
    assert.match(app.alert, /tijdelijk en niet opgeslagen/)
    app.denyWrite = false
    app.nav('Mand')
    app.render()
    app.nav('Planner')
    app.render()
    assert.equal(app.writes.length, 0)
    assert.equal(app.raw, defaultRaw)
    assert.match(app.alert, /browseropslag niet beschikbaar/)
    app.planner().onBudgetChange(27.5)
    app.render()
    assert.equal(JSON.parse(app.raw).budget, 27.5)
    assert.equal(app.writes.length, 1)
    assert.equal(app.alert, '')
  } finally { app.close() }
})

test('product #1925: batched day toggles and budget edit compose without losing earlier intent', () => {
  const app = mount()
  try {
    app.render()
    const original = JSON.parse(app.raw)
    const [firstDay, secondDay] = m2InitialPlan.slice(0, 2).map(day => day.day)
    assert.notEqual(firstDay, secondDay)
    const originalActive = new Set(original.activeDays)
    const planner = app.planner()
    planner.onToggleDay(firstDay)
    planner.onToggleDay(secondDay)
    planner.onBudgetChange(42.75)
    app.render()
    const expected = new Set(originalActive)
    for (const day of [firstDay, secondDay]) {
      if (expected.has(day)) expected.delete(day)
      else expected.add(day)
    }
    assert.equal(JSON.parse(app.raw).budget, 42.75)
    assert.deepEqual(new Set(JSON.parse(app.raw).activeDays), expected)
    assert.equal(app.writes.length, 2, 'mount and one combined edit snapshot')
    assert.equal(app.alert, '')
  } finally { app.close() }
})

test('product #1925: external future-schema replacement stays byte-exact after a new edit', () => {
  const app = mount({ denyWrite: true })
  try {
    app.render()
    assert.match(app.alert, /niet opgeslagen/)
    app.denyWrite = false
    const future = JSON.stringify({
      schemaVersion: 9, budget: 999, activeDays: [], recipeByDay: {},
      futureOwner: 'untouched',
    })
    app.raw = future
    app.planner().onBudgetChange(31.25)
    app.render()
    assert.equal(app.raw, future, 'must not downgrade unknown external storage')
    assert.equal(app.writes.length, 0)
    assert.match(app.alert, /Eerdere opgeslagen gegevens blijven bewaard/)
    assert.equal(app.planner().budget, 31.25, 'session still responds to user')
  } finally { app.close() }
})
