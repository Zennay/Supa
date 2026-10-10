import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { isTrustworthyShoppingBasket } from '../src/features/shopping-list/shoppingListPhysicalValidity.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'

const copyFile = new URL('../src/features/shopping-list/ShoppingListCopyButton.tsx', import.meta.url)
const componentSource = readFileSync(copyFile, 'utf8')
const compiled = ts.transpileModule(componentSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'ShoppingListCopyButton.tsx',
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])

const createNode = (type, props) => ({ type, props })

function currentBasket(activeDays = m2DefaultActiveDays) {
  return buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays,
    products: m2Products,
  })
}

// Run the actual production TSX with stateful hooks rather than an isolated
// replacement component. No browser APIs, clipboard privileges or network.
function exportHarness(basket, doneLineIds) {
  const states = []
  let cursor = 0
  const react = {
    useEffect() {},
    useId() { return 'copy-field-test' },
    useState(initial) {
      const index = cursor++
      if (!Object.hasOwn(states, index)) states[index] = initial
      return [states[index], (next) => {
        states[index] = typeof next === 'function' ? next(states[index]) : next
      }]
    },
  }
  const dependencies = {
    react,
    'react/jsx-runtime': { jsx: createNode, jsxs: createNode },
    './shoppingListCopyText': { buildShoppingListCopyText },
    './shoppingListPhysicalValidity.ts': { isTrustworthyShoppingBasket },
    './shoppingListCopyButton.css': {},
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, (name) => {
      assert.ok(Object.hasOwn(dependencies, name), 'unexpected copy module import: ' + name)
      return dependencies[name]
    },
  )
  function render() {
    cursor = 0
    return module.exports.ShoppingListCopyButton({ basket, doneLineIds })
  }
  function find(root, type) {
    if (!root || typeof root !== 'object') return null
    if (Array.isArray(root)) {
      for (const child of root) {
        const match = find(child, type)
        if (match) return match
      }
      return null
    }
    if (root.type === type) return root
    return find(root.props?.children, type)
  }
  return { render, find }
}

test('actual ShoppingListView renders copy controls against its currently trusted v2 checkmarks', () => {
  const viewSource = readFileSync(
    new URL('../src/features/shopping-list/ShoppingListView.tsx', import.meta.url), 'utf8',
  )
  assert.match(viewSource, /import \{ ShoppingListCopyButton \} from/)
  assert.match(
    viewSource,
    /<ShoppingListCopyButton basket=\{basket\} doneLineIds=\{done\} \/>/,
  )
  assert.doesNotMatch(viewSource, /<ShoppingListCopyButton[^>]+progress\.done/)
})

test('real copy JSX reveals checked physical pack text only on explicit user action', () => {
  const basket = currentBasket()
  assert.equal(isTrustworthyShoppingBasket(basket), true)
  const checked = basket.lines.find(line => line.status === 'matched')
  assert.ok(checked)
  const ui = exportHarness(basket, [checked.id])
  let tree = ui.render()
  const open = ui.find(tree, 'button')
  assert.ok(open)
  assert.equal(open.props.disabled, false)
  assert.equal(open.props['aria-expanded'], false)
  assert.equal(ui.find(tree, 'textarea'), null)
  open.props.onClick()
  tree = ui.render()
  assert.equal(ui.find(tree, 'button').props['aria-expanded'], true)
  const field = ui.find(tree, 'textarea')
  assert.ok(field)
  assert.equal(field.props.readOnly, true)
  assert.equal(field.props.value, buildShoppingListCopyText(basket, [checked.id]))
  assert.ok(field.props.value.includes('[x] ' + checked.productName))
  assert.doesNotMatch(field.props.value, /€|besparing|prijsverschil/i)
  let selected = false
  field.props.onFocus({ currentTarget: { select() { selected = true } } })
  assert.equal(selected, true)
})

test('real copy JSX never enables export for malformed physical or monetary baskets', () => {
  const valid = currentBasket()
  const brokenTotal = structuredClone(valid)
  brokenTotal.totalCents += 1
  const brokenQuantity = structuredClone(valid)
  const first = brokenQuantity.lines.find(line => line.status === 'matched')
  first.pack.unit = first.pack.unit === 'g' ? 'l' : 'g'
  for (const basket of [brokenTotal, brokenQuantity]) {
    assert.equal(isTrustworthyShoppingBasket(basket), false)
    const ui = exportHarness(basket, [])
    const tree = ui.render()
    const button = ui.find(tree, 'button')
    assert.equal(button.props.disabled, true)
    assert.equal(ui.find(tree, 'textarea'), null)
    assert.ok(ui.find(tree, 'span'))
  }
})

test('real copy JSX refuses stale checkbox IDs instead of exporting fictional ticks', () => {
  const ui = exportHarness(currentBasket(), ['not-in-current-basket'])
  const tree = ui.render()
  assert.equal(ui.find(tree, 'button').props.disabled, true)
  assert.equal(ui.find(tree, 'textarea'), null)
})
