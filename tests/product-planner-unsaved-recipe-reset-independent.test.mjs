import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { defaultPlannerPreferences, serializePlannerPreferences } from '../src/domain/plannerPreferences.ts'
import { restorePlannerPreferencesWithCustomBudget } from '../src/features/planner/customWeekBudget.ts'

// Product #1925: independent actual-compiled App.tsx planner choice lifecycle.
// Synthetic browser storage and controlled M2 fixtures only; no field evidence.
const built = ts.transpileModule(
  readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  { fileName: 'App.tsx', compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  }, reportDiagnostics: true },
)
assert.deepEqual(built.diagnostics, [])
const realRequire = createRequire(import.meta.url)
const PlannerView = () => null
const BasketView = () => null
const ShoppingListView = () => null
const ObservationView = () => null
const key = 'supa:planner-preferences:v2'
const defaults = defaultPlannerPreferences(m2InitialPlan)
const defaultRaw = serializePlannerPreferences(defaults)
function flatten(tree) {
  if (Array.isArray(tree)) return tree.flatMap(flatten)
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return []
  return [tree, ...flatten(tree.props.children)]
}
function mount(initial = defaultRaw) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let disk = initial
  let refuseWrites = false
  const writes = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: {
      getItem(name) {
        assert.equal(name, key)
        return disk
      },
      setItem(name, value) {
        assert.equal(name, key)
        if (refuseWrites) throw Error('synthetic write refusal')
        disk = value
        writes.push(value)
      },
    } },
  })
  let cursor = 0
  let scheduled = []
  const slots = []
  const equal = (a, b) => Array.isArray(a) && Array.isArray(b) &&
    a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const hooks = {
    useState(initialState) {
      const n = cursor++
      if (!(n in slots)) slots[n] = { value: typeof initialState === 'function'
        ? initialState() : initialState }
      return [slots[n].value, next => {
        slots[n].value = typeof next === 'function' ? next(slots[n].value) : next
      }]
    },
    useMemo(create, dependencies) {
      const n = cursor++
      if (!(n in slots) || !equal(slots[n].deps, dependencies)) {
        slots[n] = { value: create(), deps: dependencies }
      }
      return slots[n].value
    },
    useEffect(effect, dependencies) {
      const n = cursor++
      if (!(n in slots) || !equal(slots[n].deps, dependencies)) {
        slots[n] = { deps: dependencies }
        scheduled.push(effect)
      }
    },
  }
  function load(name) {
    if (name === 'react') return hooks
    if (name === 'react/jsx-runtime') return realRequire(name)
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
    throw Error('unexpected App import: ' + name)
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', built.outputText)(module, module.exports, load)
  function render() {
    cursor = 0
    scheduled = []
    const nodes = flatten(module.exports.App())
    for (const effect of scheduled) effect()
    return nodes
  }
  function planner() {
    const node = render().find(n => n.type === PlannerView)
    assert.ok(node)
    return node.props
  }
  function warning() {
    return String(render().find(n => n.type === 'p' && n.props.role === 'alert')?.props.children ?? '')
  }
  function navigate(label) {
    const node = render().find(n => n.type === 'button' && n.props.children === label)
    assert.ok(node, 'navigation exists: ' + label)
    node.props.onClick()
  }
  return {
    render, planner, warning, navigate, writes,
    get raw() { return disk }, set raw(value) { disk = value },
    set refuseWrites(value) { refuseWrites = value },
    close() {
      if (original) Object.defineProperty(globalThis, 'window', original)
      else delete globalThis.window
    },
  }
}

test('product #1925: recipe/day/budget edits compose in session after denied save and persist on fresh intent', () => {
  const app = mount()
  const [first, second] = m2InitialPlan.slice(0, 2).map(row => row.day)
  const changedRecipe = m2Recipes.find(recipe => recipe.id !== defaults.recipeByDay[first])
  assert.ok(changedRecipe, 'controlled fixture offers another recipe')
  try {
    app.refuseWrites = true
    app.render()
    assert.match(app.warning(), /tijdelijk en niet opgeslagen/)
    const p = app.planner()
    p.onRecipeChange(first, changedRecipe.id)
    p.onToggleDay(second)
    p.onBudgetChange(27.5)
    app.render()
    assert.equal(app.raw, defaultRaw, 'no failed save may claim durability')
    assert.equal(app.planner().plannedMeals.find(meal => meal.day === first)?.recipeId, changedRecipe.id)
    assert.equal(app.planner().budget, 27.5)
    assert.equal(app.planner().activeDays.includes(second), !defaults.activeDays.includes(second))
    app.refuseWrites = false
    app.navigate('Mand')
    app.navigate('Planner')
    app.render()
    assert.equal(app.raw, defaultRaw, 'passive navigation must not write')
    assert.match(app.warning(), /niet opgeslagen/)
    app.planner().onBudgetChange(27.51)
    app.render()
    const saved = JSON.parse(app.raw)
    assert.equal(saved.budget, 27.51)
    assert.equal(saved.recipeByDay[first], changedRecipe.id)
    assert.equal(saved.activeDays.includes(second), !defaults.activeDays.includes(second))
    assert.equal(app.writes.length, 1)
    assert.equal(app.warning(), '')
  } finally { app.close() }
})

test('product #1925: reset stays interactive but cannot replace unknown future record', () => {
  const future = '{"version":99,"budget":45,"futureData":"retain byte-for-byte"}'
  const app = mount(future)
  try {
    app.render()
    assert.match(app.warning(), /Eerdere opgeslagen gegevens blijven bewaard/)
    const p = app.planner()
    p.onBudgetChange(42.75)
    p.onReset()
    app.render()
    assert.equal(app.planner().budget, defaults.budget)
    assert.deepEqual(app.planner().activeDays, defaults.activeDays)
    assert.equal(app.raw, future)
    assert.equal(app.writes.length, 0)
    app.raw = null // external explicit removal; no automatic retry
    app.render()
    assert.equal(app.raw, null)
    assert.match(app.warning(), /niet opgeslagen/)
    app.planner().onBudgetChange(0.01)
    app.render()
    assert.equal(JSON.parse(app.raw).budget, 0.01)
    assert.equal(app.warning(), '')
    assert.equal(app.writes.length, 1)
  } finally { app.close() }
})

test('product #1925: valid saved recipe remains quiet when changed alongside a day toggle', () => {
  const first = m2InitialPlan[0].day
  const other = m2Recipes.find(recipe => recipe.id !== defaults.recipeByDay[first])
  assert.ok(other)
  const app = mount()
  try {
    app.render()
    assert.equal(app.warning(), '')
    app.planner().onRecipeChange(first, other.id)
    app.planner().onToggleDay(first)
    app.render()
    const saved = JSON.parse(app.raw)
    assert.equal(saved.recipeByDay[first], other.id)
    assert.equal(saved.activeDays.includes(first), !defaults.activeDays.includes(first))
    assert.equal(app.warning(), '')
  } finally { app.close() }
})
