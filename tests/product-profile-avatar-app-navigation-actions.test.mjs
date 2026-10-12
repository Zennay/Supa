import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

// Product #596: execute the actual compiled App JSX handlers with an isolated
// deterministic hook scheduler. This is NOT a browser/mobile interaction test.
// No product sources or original App owner tests are modified.
const nodeRequire = createRequire(import.meta.url)
const jsxRuntime = {
  jsx: (type, props) => ({ type, props }),
  jsxs: (type, props) => ({ type, props }),
}
const slots = []
let hookIndex = 0
const reactHooks = {
  useState(initial) {
    const index = hookIndex++
    if (!Object.hasOwn(slots, index)) {
      slots[index] = typeof initial === 'function' ? initial() : initial
    }
    return [
      slots[index],
      (next) => {
        slots[index] = typeof next === 'function' ? next(slots[index]) : next
      },
    ]
  },
  useMemo: (calculate) => calculate(),
  useEffect: () => {},
}
function compileTsx(path, resolve) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  })
  assert.deepEqual(compiled.diagnostics, [])
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, resolve,
  )
  return module.exports
}
const { IdentityAvatar } = compileTsx(
  '../src/components/IdentityAvatar.tsx',
  (name) => name === 'react/jsx-runtime' ? jsxRuntime : nodeRequire(name),
)
const views = {
  PlannerView: () => {},
  BasketView: () => {},
  ShoppingListView: () => {},
  ObservationView: () => {},
}
const prefs = () => ({
  budget: 35,
  activeDays: ['Ma'],
  recipeByDay: { Ma: 'recipe' },
})
const dependencies = {
  './features/planner/PlannerView': { PlannerView: views.PlannerView },
  './features/basket/BasketView': { BasketView: views.BasketView },
  './features/shopping-list/ShoppingListView': {
    ShoppingListView: views.ShoppingListView,
  },
  './features/observation/ObservationView': {
    ObservationView: views.ObservationView,
  },
  './components/IdentityAvatar.tsx': { IdentityAvatar },
  './domain/basket': {
    buildOneStoreBasket: () => ({ totalCents: 0, unresolvedLineCount: 0 }),
  },
  './domain/basketComparison': { compareFullBaskets: () => ({}) },
  './domain/plannerPreferences': {
    defaultPlannerPreferences: prefs,
    parsePlannerPreferences: prefs,
    serializePlannerPreferences: () => '{}',
  },
  './data/m2Fixture': {
    m2InitialPlan: [{ day: 'Ma', recipeId: 'recipe' }],
    m2Recipes: [{ id: 'recipe' }],
    m2Products: [],
    m2Store: { id: 'store', name: 'Store' },
  },
  './data/m3ComparisonFixture': {
    m3BaselineProducts: [],
    m3CandidateProducts: [],
    m3BaselineStore: { id: 'plus', name: 'PLUS' },
    m3CandidateStore: { id: 'deka', name: 'DekaMarkt' },
  },
}
const { App } = compileTsx('../src/App.tsx', (name) => {
  if (name === 'react') return reactHooks
  if (name === 'react/jsx-runtime') return jsxRuntime
  if (Object.hasOwn(dependencies, name)) return dependencies[name]
  return nodeRequire(name)
})

function render() {
  hookIndex = 0
  return App()
}
function findNodes(tree, type) {
  if (Array.isArray(tree)) return tree.flatMap((item) => findNodes(item, type))
  if (tree === null || typeof tree !== 'object') return []
  const found = tree.type === type ? [tree] : []
  return found.concat(findNodes(tree.props?.children, type))
}
function assertActive(root, label, component) {
  const nav = findNodes(root, 'nav')
  assert.equal(nav.length, 1)
  const buttons = findNodes(nav[0], 'button')
  assert.deepEqual(
    buttons.map((button) => button.props.children),
    ['Planner', 'Mand', 'Lijst', 'Meten'],
  )
  assert.ok(buttons.every((button) => button.props.type === 'button'))
  assert.deepEqual(
    buttons.filter((button) => button.props['aria-current'] === 'page')
      .map((button) => button.props.children),
    [label],
  )
  assert.equal(findNodes(root, component).length, 1)
  return buttons
}

test('product #596: actual App tab handlers switch active view and current-page semantics', () => {
  let buttons = assertActive(render(), 'Planner', views.PlannerView)
  for (const [index, label, component] of [
    [1, 'Mand', views.BasketView],
    [2, 'Lijst', views.ShoppingListView],
    [3, 'Meten', views.ObservationView],
    [0, 'Planner', views.PlannerView],
  ]) {
    assert.equal(typeof buttons[index].props.onClick, 'function')
    buttons[index].props.onClick()
    buttons = assertActive(render(), label, component)
  }
})

test('product #596: real App keeps demo identity out of the focusable navigation', () => {
  const root = render()
  const header = findNodes(root, 'header')
  assert.equal(header.length, 1)
  assert.equal(findNodes(root, 'button').length, 4)
  const identities = findNodes(header[0], IdentityAvatar)
  assert.equal(identities.length, 1)
  const span = IdentityAvatar()
  assert.equal(span.type, 'span')
  assert.equal(span.props.role, 'img')
  assert.equal(span.props['aria-label'], 'Demo-avatar')
  assert.equal(span.props['data-profile-action'], 'none')
  assert.equal(span.props.children, 'ZE')
  assert.equal(span.props.onClick, undefined)
  assert.equal(span.props.tabIndex, undefined)
})
