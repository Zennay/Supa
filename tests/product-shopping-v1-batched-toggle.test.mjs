import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2Store, m2Recipes, m2Products, m2InitialPlan } from '../src/data/m2Fixture.ts'
import { quantityUnitLabelNl } from '../src/lib/quantityPresentation.ts'
import * as saved from '../src/features/shopping-list/shoppingListProgress.ts'

// Actual compiled shopping-v1 onClick closures with synchronously applied
// functional setState updates. No DOM/touch event timing or saved store prices.
const require = createRequire(import.meta.url)
const compiled = ts.transpileModule(
  readFileSync(new URL('../src/features/shopping-list/ShoppingListView.tsx', import.meta.url), 'utf8'),
  {
    fileName: 'ShoppingListView.tsx',
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  },
)
assert.deepEqual(compiled.diagnostics, [])

function basket() {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    products: m2Products, activeDays: ['Di'],
  })
}

function app() {
  const slots = []
  let hook = 0
  const imports = name => {
    if (name === 'react') return {
      useMemo: fn => fn(),
      useEffect() {},
      useState(initial) {
        const index = hook++
        if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
        return [slots[index], update => {
          slots[index] = typeof update === 'function' ? update(slots[index]) : update
        }]
      },
    }
    if (name === 'react/jsx-runtime') return require(name)
    if (name === '../../lib/quantityPresentation') return { quantityUnitLabelNl }
    if (name === './shoppingListProgress') return saved
    throw Error('Unexpected v1 source dependency: ' + name)
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, imports,
  )
  function allNodes(node) {
    if (Array.isArray(node)) return node.flatMap(allNodes)
    if (!node || typeof node !== 'object' || !('props' in node)) return []
    return [node, ...allNodes(node.props.children)]
  }
  function rows(currentBasket) {
    hook = 0
    return allNodes(module.exports.ShoppingListView({ basket: currentBasket }))
      .filter(node => node.type === 'button' && node.props.className?.split(' ').includes('shopping-row'))
  }
  function checked(row) {
    return row.props.className.split(' ').includes('checked')
  }
  return { rows, checked }
}

test('product v1: two back-to-back taps from one frame undo rather than duplicate a checkmark', () => {
  const current = basket()
  const before = structuredClone(current)
  const page = app()
  const initial = page.rows(current)
  assert.ok(initial.length >= 2)
  const first = initial[0]
  assert.equal(page.checked(first), false)
  first.props.onClick()
  first.props.onClick() // React can batch these before a new render
  assert.equal(page.checked(page.rows(current)[0]), false,
    'two toggles must undo each other, not leave a stale checked state')
  assert.deepEqual(current, before, 'callback must not mutate basket data')
})

test('product v1: odd/even same-frame toggles track the current state, not old render closure', () => {
  const current = basket()
  const page = app()
  const first = page.rows(current)[0]
  first.props.onClick()
  first.props.onClick()
  first.props.onClick()
  assert.equal(page.checked(page.rows(current)[0]), true)
  first.props.onClick()
  assert.equal(page.checked(page.rows(current)[0]), false)
})

test('product v1: rapid mixed-row taps keep only the row with odd number of actions checked', () => {
  const current = basket()
  const page = app()
  const rows = page.rows(current)
  const [first, second] = rows
  assert.ok(first && second)
  first.props.onClick()
  second.props.onClick()
  first.props.onClick()
  const latest = page.rows(current)
  assert.equal(page.checked(latest[0]), false)
  assert.equal(page.checked(latest[1]), true)
  assert.equal(latest.filter(page.checked).length, 1)
})
