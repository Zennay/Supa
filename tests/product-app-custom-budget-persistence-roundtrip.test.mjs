import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import {
  defaultPlannerPreferences,
  serializePlannerPreferences,
} from '../src/domain/plannerPreferences.ts'
import { restorePlannerPreferencesWithCustomBudget } from '../src/features/planner/customWeekBudget.ts'

// Product-core #1424: execute the actual compiled App.tsx state callbacks,
// storage effect and app navigation, instead of testing only a copied adapter.
// In-memory DOM/storage doubles are synthetic: not Firefox or observed pricing.
const nativeRequire = createRequire(import.meta.url)
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: 'App.tsx',
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])

const PlannerView = function PlannerView() {}
const BasketView = function BasketView() {}
const ShoppingListView = function ShoppingListView() {}
const ObservationView = function ObservationView() {}

function appHarness(storage) {
  const states = []
  let position = 0
  let effects = []
  const useState = initial => {
    const index = position++
    if (!(index in states)) {
      states[index] = typeof initial === 'function' ? initial() : initial
    }
    return [states[index], next => {
      states[index] = typeof next === 'function' ? next(states[index]) : next
    }]
  }
  const imports = name => {
    if (name === 'react') return {
      useState, useMemo: calculate => calculate(),
      useEffect: callback => effects.push(callback),
    }
    if (name === 'react/jsx-runtime') return nativeRequire(name)
    if (name === './features/planner/PlannerView') return { PlannerView }
    if (name === './features/basket/BasketView') return { BasketView }
    if (name === './features/shopping-list/ShoppingListView') return { ShoppingListView }
    if (name === './features/observation/ObservationView') return { ObservationView }
    if (name === './domain/basket') return {
      buildOneStoreBasket: () => ({ totalCents: 1969, unresolvedLineCount: 0, lines: [] }),
    }
    if (name === './domain/basketComparison') return {
      compareFullBaskets: () => ({}),
    }
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
    throw new Error('Unexpected App dependency: ' + name)
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, imports,
  )
  const nodes = item => {
    if (Array.isArray(item)) return item.flatMap(nodes)
    if (item === null || typeof item !== 'object' || !('props' in item)) return []
    return [item, ...nodes(item.props.children)]
  }
  function render() {
    position = 0
    effects = []
    const all = nodes(module.exports.App())
    effects.forEach(callback => callback())
    return all
  }
  function planner() {
    const node = render().find(item => item.type === PlannerView)
    assert.ok(node, 'Planner tab must be active')
    return node.props
  }
  function nav(label) {
    const button = render().find(item => item.type === 'button' && item.props.children === label)
    assert.ok(button, 'Expected ' + label + ' navigation')
    button.props.onClick()
  }
  return { render, planner, nav, storage }
}

function memoryStorage(initial) {
  const contents = new Map()
  const key = 'supa:planner-preferences:v2'
  if (initial !== undefined) contents.set(key, initial)
  let writes = 0
  return {
    key, contents,
    get writes() { return writes },
    getItem(k) { return contents.get(k) ?? null },
    setItem(k, v) { writes++; contents.set(k, v) },
    saved() { return JSON.parse(contents.get(key)) },
  }
}

function inWindow(storage, action) {
  const previous = globalThis.window
  try {
    globalThis.window = { localStorage: storage }
    return action()
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
}

test('product #1424: App restores, commits and reopens a cent-exact budget without losing chosen days', () => {
  const starting = serializePlannerPreferences({
    ...defaultPlannerPreferences(m2InitialPlan),
    budget: 27.50,
    activeDays: ['Di'],
  })
  const storage = memoryStorage(starting)
  inWindow(storage, () => {
    const first = appHarness(storage)
    assert.equal(first.planner().budget, 27.5)
    assert.deepEqual(first.planner().activeDays, ['Di'])
    first.planner().onBudgetChange(42.75)
    assert.equal(first.planner().budget, 42.75)
    assert.equal(storage.saved().budget, 42.75)
    assert.deepEqual(storage.saved().activeDays, ['Di'])
    first.nav('Mand')
    assert.ok(first.render().some(node => node.type === BasketView))
    first.nav('Planner')
    assert.equal(first.planner().budget, 42.75)
    const reopened = appHarness(storage)
    assert.equal(reopened.planner().budget, 42.75)
    assert.deepEqual(reopened.planner().activeDays, ['Di'])
    assert.equal(reopened.planner().basketTotalCents, 1969)
  })
})

test('product #1424: App reset clears saved custom selection and keeps chip default on reload', () => {
  const storage = memoryStorage(JSON.stringify({
    ...defaultPlannerPreferences(m2InitialPlan), budget: 1000,
  }))
  inWindow(storage, () => {
    const page = appHarness(storage)
    assert.equal(page.planner().budget, 1000)
    page.planner().onReset()
    assert.equal(page.planner().budget, 35)
    assert.equal(storage.saved().budget, 35)
    assert.equal(appHarness(storage).planner().budget, 35)
  })
})

test('product #1424: App never trusts an invalid stored sub-cent amount', () => {
  const storage = memoryStorage(JSON.stringify({
    ...defaultPlannerPreferences(m2InitialPlan),
    budget: 27.501,
  }))
  inWindow(storage, () => {
    const page = appHarness(storage)
    assert.equal(page.planner().budget, 35)
    assert.equal(storage.saved().budget, 35)
  })
})

test('product #1424: denied browser storage leaves App budget editable in session', () => {
  const storage = {
    getItem() { throw new Error('storage denied') },
    setItem() { throw new Error('storage denied') },
  }
  inWindow(storage, () => {
    const page = appHarness(storage)
    assert.equal(page.planner().budget, 35)
    page.planner().onBudgetChange(27.5)
    assert.equal(page.planner().budget, 27.5)
    page.nav('Mand')
    page.nav('Planner')
    assert.equal(page.planner().budget, 27.5)
  })
})


test('product #1424: changing recipes and active days cannot silently reset a committed custom budget', () => {
  const initial = defaultPlannerPreferences(m2InitialPlan)
  const selected = m2InitialPlan[0]
  const alternative = m2Recipes.find(recipe => recipe.id !== selected.recipeId)
  assert.ok(selected && alternative)
  const storage = memoryStorage(serializePlannerPreferences({ ...initial, budget: 27.5 }))
  inWindow(storage, () => {
    const page = appHarness(storage)
    page.planner().onRecipeChange(selected.day, alternative.id)
    assert.equal(page.planner().budget, 27.5)
    assert.equal(page.planner().plannedMeals.find(meal => meal.day === selected.day)?.recipeId, alternative.id)
    assert.equal(storage.saved().recipeByDay[selected.day], alternative.id)
    assert.equal(storage.saved().budget, 27.5)
    page.planner().onToggleDay(selected.day)
    assert.equal(page.planner().budget, 27.5)
    assert.ok(!page.planner().activeDays.includes(selected.day))
    assert.equal(storage.saved().budget, 27.5)
    const restarted = appHarness(storage)
    assert.equal(restarted.planner().budget, 27.5)
    assert.ok(!restarted.planner().activeDays.includes(selected.day))
    assert.equal(restarted.planner().plannedMeals.find(meal => meal.day === selected.day)?.recipeId, alternative.id)
    restarted.planner().onToggleDay(selected.day)
    assert.equal(restarted.planner().budget, 27.5)
    assert.ok(restarted.planner().activeDays.includes(selected.day))
  })
})
