import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  defaultPlannerPreferences, parsePlannerPreferences, serializePlannerPreferences,
} from '../src/domain/plannerPreferences.ts'
import {
  m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts, m3BaselineStore, m3CandidateProducts, m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

// This independent acceptance compiles the CURRENT App.tsx, retaining actual
// navigation callbacks and real M2 basket computation. The hook harness is
// synchronous and is NOT a hydrated browser or Firefox acceptance test.
const require = createRequire(import.meta.url)
const compiled = ts.transpileModule(
  readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  {
    fileName: 'App.tsx',
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  },
)
assert.deepEqual(compiled.diagnostics, [])

const PlannerView = () => null
const ShoppingListView = () => null
const BasketView = () => null
const ObservationView = () => null

function mountApp() {
  const slots = []
  let index = 0
  const useState = initial => {
    const position = index++
    if (!(position in slots)) slots[position] = typeof initial === 'function' ? initial() : initial
    return [slots[position], update => {
      slots[position] = typeof update === 'function' ? update(slots[position]) : update
    }]
  }
  const dependencies = new Map([
    ['react', {
      useState, useMemo: compute => compute(), useEffect: () => {},
    }],
    ['react/jsx-runtime', require('react/jsx-runtime')],
    ['./features/planner/PlannerView', { PlannerView }],
    ['./features/basket/BasketView', { BasketView }],
    ['./features/shopping-list/ShoppingListView', { ShoppingListView }],
    ['./features/observation/ObservationView', { ObservationView }],
    ['./domain/basket', { buildOneStoreBasket }],
    ['./domain/basketComparison', { compareFullBaskets }],
    ['./domain/plannerPreferences', {
      defaultPlannerPreferences, parsePlannerPreferences, serializePlannerPreferences,
    }],
    ['./data/m2Fixture', { m2InitialPlan, m2Products, m2Recipes, m2Store }],
    ['./data/m3ComparisonFixture', {
      m3BaselineProducts, m3BaselineStore, m3CandidateProducts, m3CandidateStore,
    }],
  ])
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, key => {
      assert.ok(dependencies.has(key), 'unexpected App dependency: ' + key)
      return dependencies.get(key)
    },
  )
  const walk = value => {
    if (Array.isArray(value)) return value.flatMap(walk)
    if (value === null || typeof value !== 'object' || !('props' in value)) return []
    return [value, ...walk(value.props.children)]
  }
  const render = () => {
    index = 0
    return walk(module.exports.App())
  }
  const page = (tree, component) => tree.find(node => node.type === component)
  const nav = (tree, label) => {
    const button = tree.find(node => node.type === 'button' && node.props.children === label)
    assert.ok(button, 'missing navigation control: ' + label)
    button.props.onClick()
  }
  return { render, page, nav }
}

test('product: routed Lijst receives the real M2 basket, not a detached v2 list', () => {
  const app = mountApp()
  const initial = app.render()
  assert.ok(app.page(initial, PlannerView))
  assert.equal(app.page(initial, ShoppingListView), undefined)
  app.nav(initial, 'Lijst')

  const list = app.page(app.render(), ShoppingListView)
  assert.ok(list, 'App must route the current v1 ShoppingListView')
  const expected = buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: defaultPlannerPreferences(m2InitialPlan).activeDays,
    products: m2Products,
  })
  assert.deepEqual(list.props.basket, expected)
  assert.deepEqual(list.props.basket.lines, expected.lines)
})

test('product: navigating after a day edit routes updated physical demand to current shopping view', () => {
  const app = mountApp()
  const initial = app.render()
  const planner = app.page(initial, PlannerView)
  assert.ok(planner)
  const original = buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: planner.props.activeDays, products: m2Products,
  })
  planner.props.onToggleDay('Ma')
  app.nav(app.render(), 'Lijst')
  const list = app.page(app.render(), ShoppingListView)
  assert.ok(list)
  const remainingDays = planner.props.activeDays.filter(day => day !== 'Ma')
  const expected = buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: remainingDays, products: m2Products,
  })
  assert.deepEqual(list.props.basket, expected)
  assert.notDeepEqual(list.props.basket, original, 'list reflects edited planned demand')
  assert.deepEqual(m2InitialPlan, m2InitialPlan.map(meal => ({ ...meal })),
    'fixture source remains unchanged')
})
