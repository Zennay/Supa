import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { defaultPlannerPreferences, serializePlannerPreferences } from '../src/domain/plannerPreferences.ts'
import { restorePlannerPreferencesWithCustomBudget } from '../src/features/planner/customWeekBudget.ts'
import { canReplacePlannerRecord, persistPlannerRecord } from '../src/features/planner/plannerStorageGuard.ts'

// Execute the real current App TSX, not a string-only source check. Every
// storage record is fictional; no user/device/retailer access is performed.
const require = createRequire(import.meta.url)
const tsx = ts.transpileModule(readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), {
  fileName: 'App.tsx',
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
})
assert.deepEqual(tsx.diagnostics, [])

const key = 'supa:planner-preferences:v2'
const PlannerView = () => {}
const BasketView = () => {}
const ShoppingListView = () => {}
const ObservationView = () => {}
const WeekShareManualCopy = () => {}
const IdentityAvatar = () => {}

function fakeDisk(first) {
  let raw = first
  let readBlocked = false
  let writeBlocked = false
  const writes = []
  return {
    writes,
    get raw() { return raw },
    set raw(value) { raw = value },
    set readBlocked(value) { readBlocked = value },
    set writeBlocked(value) { writeBlocked = value },
    getItem(k) {
      assert.equal(k, key)
      if (readBlocked) throw new Error('fictional private denial')
      return raw
    },
    setItem(k, value) {
      assert.equal(k, key)
      if (writeBlocked) throw new Error('fictional private denial')
      raw = value
      writes.push(value)
    },
  }
}

function flatten(tree) {
  if (Array.isArray(tree)) return tree.flatMap(flatten)
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return []
  return [tree, ...flatten(tree.props.children)]
}

function mount(disk, { denyGetter = false } = {}) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const browser = denyGetter
    ? Object.defineProperty({}, 'localStorage', {
        get() { throw new Error('fictional getter denial') },
      })
    : { localStorage: disk }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser })
  const slots = []
  let index = 0
  let pendingEffects = []
  const equalDeps = (a, b) => Array.isArray(a) && Array.isArray(b) &&
    a.length === b.length && a.every((v, n) => Object.is(v, b[n]))
  const hooks = {
    useState(initial) {
      const id = index++
      if (!(id in slots)) slots[id] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[id].value, (next) => {
        slots[id].value = typeof next === 'function' ? next(slots[id].value) : next
      }]
    },
    useMemo(compute, deps) {
      const id = index++
      if (!(id in slots) || !equalDeps(slots[id].deps, deps)) {
        slots[id] = { value: compute(), deps }
      }
      return slots[id].value
    },
    useEffect(effect, deps) {
      const id = index++
      if (!(id in slots) || !equalDeps(slots[id].deps, deps)) {
        slots[id] = { deps }
        pendingEffects.push(effect)
      }
    },
  }
  const dependencies = (name) => {
    if (name === 'react') return hooks
    if (name === 'react/jsx-runtime') return require(name)
    const modules = {
      './features/planner/PlannerView': { PlannerView },
      './features/planner/WeekShareManualCopy': { WeekShareManualCopy },
      './features/planner/weekPlanShare': {
        currentWeekSharePreview: () => null, formatShareableWeek: () => 'fictional-plan',
      },
      './features/basket/BasketView': { BasketView },
      './features/shopping-list/ShoppingListView': { ShoppingListView },
      './features/observation/ObservationView': { ObservationView },
      './components/IdentityAvatar.tsx': { IdentityAvatar },
      './features/home/HiFiHome': { HiFiHome: () => {}, HiFiDemoList: () => {} },
      './features/home/figmaAssets': { figmaAssets: {} },
      './components/FigmaImage': { FigmaImage: () => {} },
      './features/recipes/recipeLibrary': { readRecipeLibrary: () => ({ recipes: [], raw: null, error: null }) },
      './features/recipes/plannerRecipes': { toPlannerRecipe: () => null },
      './domain/basket': { buildOneStoreBasket: () => ({
        totalCents: 1500, unresolvedLineCount: 0, lines: [],
      }) },
      './domain/basketComparison': { compareFullBaskets: () => ({}) },
      './domain/plannerPreferences': {
        defaultPlannerPreferences, serializePlannerPreferences,
      },
      './features/planner/customWeekBudget.ts': {
        restorePlannerPreferencesWithCustomBudget,
      },
      './features/planner/plannerStorageGuard.ts': {
        canReplacePlannerRecord, persistPlannerRecord,
      },
      './data/m2Fixture': { m2InitialPlan, m2Products, m2Recipes, m2Store },
      './data/m3ComparisonFixture': {
        m3BaselineProducts: [], m3CandidateProducts: [],
        m3BaselineStore: m2Store, m3CandidateStore: m2Store,
      },
    }
    if (!Object.hasOwn(modules, name)) throw Error('unexpected App dependency: ' + name)
    return modules[name]
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', tsx.outputText)(
    module, module.exports, dependencies,
  )
  function render() {
    index = 0
    pendingEffects = []
    const nodes = flatten(module.exports.App({ initialTab: 'planner' }))
    for (const effect of pendingEffects) effect()
    return nodes
  }
  function planner() {
    const props = render().find(node => node.type === PlannerView)?.props
    assert.ok(props, 'actual Planner must remain routed')
    return props
  }
  function alert() {
    const node = render().find(x => x.type === 'p' && x.props.role === 'alert')
    return String(node?.props.children ?? '')
  }
  function navigate(label) {
    const element = render().find(x => x.type === 'button' && (x.props.children === label || x.props['aria-label'] === label))
    assert.ok(element)
    element.props.onClick()
  }
  function close() {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
  }
  return { render, planner, alert, navigate, close }
}

test('real App displays unsaved warning when browser storage getter is denied', () => {
  const app = mount(fakeDisk(null), { denyGetter: true })
  try {
    assert.match(app.alert(), /tijdelijk en niet opgeslagen/)
    app.planner().onBudgetChange(27.5)
    assert.equal(app.planner().budget, 27.5)
    assert.match(app.alert(), /niet opgeslagen/)
  } finally { app.close() }
})

test('real App preserves in-session edits across tabs and clears warning on recovered save', () => {
  const disk = fakeDisk(null)
  disk.writeBlocked = true
  const app = mount(disk)
  try {
    app.render() // run the initial save effect before observing its warning
    assert.match(app.alert(), /niet opgeslagen/)
    app.planner().onBudgetChange(42.75)
    assert.equal(app.planner().budget, 42.75)
    app.navigate('Mand')
    assert.match(app.alert(), /niet opgeslagen/)
    disk.writeBlocked = false
    app.navigate('Planner')
    app.planner().onBudgetChange(27.5)
    assert.equal(app.planner().budget, 27.5)
    assert.equal(JSON.parse(disk.raw).budget, 27.5)
    assert.equal(app.alert(), '')
  } finally { app.close() }
})

test('real App does not overwrite unknown future records, but can save after explicit removal', () => {
  const future = '{"schemaVersion":3,"opaque":"future"}'
  const disk = fakeDisk(future)
  const app = mount(disk)
  try {
    assert.equal(disk.raw, future)
    assert.equal(disk.writes.length, 0)
    assert.match(app.alert(), /Eerdere opgeslagen gegevens/)
    app.planner().onBudgetChange(40)
    assert.equal(disk.raw, future)
    assert.match(app.alert(), /niet opgeslagen/)
    disk.raw = null
    app.planner().onBudgetChange(30)
    app.render() // flush the save effect after the explicit edit
    assert.equal(JSON.parse(disk.raw).budget, 30)
    assert.equal(app.alert(), '')
  } finally { app.close() }
})

test('real App does not clobber another tab and retains valid saved budget on startup', () => {
  const stored = serializePlannerPreferences({
    ...defaultPlannerPreferences(m2InitialPlan), budget: 27.5,
  })
  const disk = fakeDisk(stored)
  const app = mount(disk)
  try {
    assert.equal(app.planner().budget, 27.5)
    assert.equal(app.alert(), '')
    disk.raw = serializePlannerPreferences({
      ...defaultPlannerPreferences(m2InitialPlan), budget: 40,
    })
    app.planner().onBudgetChange(35)
    assert.equal(app.planner().budget, 35)
    assert.match(app.alert(), /Eerdere opgeslagen gegevens/)
    assert.equal(JSON.parse(disk.raw).budget, 40)
  } finally { app.close() }
})
