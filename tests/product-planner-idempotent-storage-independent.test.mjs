import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { defaultPlannerPreferences, serializePlannerPreferences } from '../src/domain/plannerPreferences.ts'
import { restorePlannerPreferencesWithCustomBudget } from '../src/features/planner/customWeekBudget.ts'

// Product #1925 independent postrepair acceptance, using compiled real App.tsx.
// Synthetic, local hook/storage doubles; no claim of permanent browser testing.
const appCode = ts.transpileModule(
  readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  { fileName: 'App.tsx', compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
  }, reportDiagnostics: true },
)
assert.deepEqual(appCode.diagnostics, [])
const actualRequire = createRequire(import.meta.url)
const PlannerView = () => null
const BasketView = () => null
const ShoppingListView = () => null
const ObservationView = () => null
const key = 'supa:planner-preferences:v2'

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return !tree || typeof tree !== 'object' || !('props' in tree)
    ? [] : [tree, ...nodes(tree.props.children)]
}
function session(initial, writable = true) {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let raw = initial
  let writing = writable
  let writes = 0
  const keys = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true, value: { localStorage: {
      getItem(name) { assert.equal(name, key); keys.push(name); return raw },
      setItem(name, value) {
        assert.equal(name, key)
        writes++
        if (!writing) throw Error('synthetic write denied')
        raw = value
      },
    } },
  })
  let n = 0
  let pending = []
  const slots = []
  const equal = (a, b) => Array.isArray(a) && Array.isArray(b) &&
    a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
  const hooks = {
    useState(first) {
      const i = n++
      if (!(i in slots)) slots[i] = { value: typeof first === 'function' ? first() : first }
      return [slots[i].value, updater => {
        slots[i].value = typeof updater === 'function' ? updater(slots[i].value) : updater
      }]
    },
    useMemo(create, deps) {
      const i = n++
      if (!(i in slots) || !equal(slots[i].deps, deps)) slots[i] = { value: create(), deps }
      return slots[i].value
    },
    useEffect(effect, deps) {
      const i = n++
      if (!(i in slots) || !equal(slots[i].deps, deps)) {
        slots[i] = { deps }
        pending.push(effect)
      }
    },
  }
  function load(name) {
    if (name === 'react') return hooks
    if (name === 'react/jsx-runtime') return actualRequire(name)
    if (name === './features/planner/PlannerView') return { PlannerView }
    if (name === './features/basket/BasketView') return { BasketView }
    if (name === './features/shopping-list/ShoppingListView') return { ShoppingListView }
    if (name === './features/observation/ObservationView') return { ObservationView }
    if (name === './domain/basket') return {
      buildOneStoreBasket: () => ({ totalCents: 1800, unresolvedLineCount: 0, lines: [] }),
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
      m3BaselineProducts: [], m3CandidateProducts: [],
      m3BaselineStore: m2Store, m3CandidateStore: m2Store,
    }
    throw Error('unexpected App.tsx dependency: ' + name)
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', appCode.outputText)(
    module, module.exports, load,
  )
  function render() {
    n = 0
    pending = []
    const result = nodes(module.exports.App())
    for (const effect of pending) effect()
    return result
  }
  function planner() {
    const result = render().find(node => node.type === PlannerView)
    assert.ok(result)
    return result.props
  }
  function warning() {
    return render().find(node => node.type === 'p' && node.props.role === 'alert')
      ?.props.children ?? null
  }
  return {
    render, planner, warning, keys,
    get raw() { return raw },
    set raw(v) { raw = v },
    get writes() { return writes },
    set writable(v) { writing = v },
    close() {
      if (old) Object.defineProperty(globalThis, 'window', old)
      else delete globalThis.window
    },
  }
}
const original = defaultPlannerPreferences(m2InitialPlan)
const day = m2InitialPlan[0].day
const differentRecipe = m2Recipes.find(recipe => recipe.id !== original.recipeByDay[day])
assert.ok(differentRecipe)
const selected = {
  budget: 27.37,
  activeDays: original.activeDays.slice(1),
  recipeByDay: { ...original.recipeByDay, [day]: differentRecipe.id },
}
const savedSelected = serializePlannerPreferences(selected)

test('product #1925 independent: existing custom budget/day/recipe needs no write on read-only mount', () => {
  const app = session(savedSelected, false)
  try {
    app.render()
    assert.equal(app.planner().budget, 27.37)
    assert.deepEqual(app.planner().activeDays, selected.activeDays)
    assert.equal(app.planner().plannedMeals.find(meal => meal.day === day).recipeId, differentRecipe.id)
    assert.equal(app.writes, 0)
    assert.equal(app.warning(), null)
    assert.equal(app.raw, savedSelected)
  } finally { app.close() }
})

test('product #1925 independent: denied real change still warns; reverting to already saved choices clears it safely', () => {
  const app = session(savedSelected, false)
  try {
    app.render()
    app.planner().onBudgetChange(27.38)
    app.render()
    assert.equal(app.raw, savedSelected)
    assert.match(String(app.warning()), /niet opgeslagen/)
    const attempted = app.writes
    assert.equal(attempted, 1)
    app.planner().onBudgetChange(27.37)
    app.render()
    assert.equal(app.writes, attempted, 'reverted durable snapshot requires no fresh write')
    assert.equal(app.raw, savedSelected)
    assert.equal(app.warning(), null)
  } finally { app.close() }
})

test('product #1925 independent: external unknown schema is protected before any new save', () => {
  const app = session(savedSelected)
  const future = '{"version":20,"future":"do not touch"}'
  try {
    app.render()
    app.raw = future
    app.planner().onBudgetChange(27.38)
    app.render()
    assert.equal(app.raw, future)
    assert.equal(app.writes, 0)
    assert.match(String(app.warning()), /blijven bewaard/)
  } finally { app.close() }
})

test('product #1925 independent: explicit new cent amount still commits exactly once', () => {
  const app = session(savedSelected)
  try {
    app.render()
    assert.equal(app.writes, 0)
    app.planner().onBudgetChange(27.38)
    app.render()
    assert.equal(JSON.parse(app.raw).budget, 27.38)
    assert.equal(app.writes, 1)
    assert.equal(app.warning(), null)
  } finally { app.close() }
})
