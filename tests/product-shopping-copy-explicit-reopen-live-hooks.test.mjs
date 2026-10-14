import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'
import { selectShoppingCopyText } from '../src/features/shopping-list/selectShoppingCopyText.ts'

const require = createRequire(import.meta.url)
const compiled = ts.transpileModule(
  readFileSync(new URL('../src/features/shopping-list/ShoppingListCopyButton.tsx', import.meta.url), 'utf8'),
  {
    fileName: 'ShoppingListCopyButton.tsx',
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  },
)
assert.deepEqual(compiled.diagnostics, [])

function createLiveCopyHarness() {
  // Keep real component JSX + onClick/state-updaters but model the React hook
  // slots deterministically, so successive renders belong to one component.
  const slots = []
  let cursor = 0
  const mockReact = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = initial
      return [
        slots[index],
        (update) => {
          slots[index] = typeof update === 'function' ? update(slots[index]) : update
        },
      ]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useId() {
      cursor++
      return ':shopping-copy:'
    },
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports,
    (specifier) => {
      if (specifier === 'react') return mockReact
      if (specifier === 'react/jsx-runtime') return require('react/jsx-runtime')
      if (specifier === './shoppingListCopyText') return { buildShoppingListCopyText }
      if (specifier === './selectShoppingCopyText') return { selectShoppingCopyText }
      if (specifier === './shoppingListCopyButton.css') return {}
      throw Error('Unexpected module: ' + specifier)
    },
  )
  return (basket, doneLineIds) => {
    cursor = 0
    const root = module.exports.ShoppingListCopyButton({ basket, doneLineIds })
    const children = root.props.children
    const button = children[0]
    return {
      button,
      expanded: button.props['aria-expanded'],
      detail: children[2],
      click: () => button.props.onClick(),
    }
  }
}

function basket() {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products: m2Products,
  })
}

test('real shopping export requires a new click on A -> B -> A checklist changes', () => {
  const value = basket()
  const id = value.lines[0].id
  assert.notEqual(
    buildShoppingListCopyText(value, []),
    buildShoppingListCopyText(value, [id]),
  )
  const render = createLiveCopyHarness()
  let current = render(value, [])
  assert.equal(current.expanded, false)
  current.click()
  current = render(value, [])
  assert.equal(current.expanded, true)
  assert.ok(current.detail, 'read-only selectable list appears only after a click')
  assert.match(current.button.props.children, /Verberg kopieerbare lijst/)

  current = render(value, [id])
  assert.equal(current.expanded, false, 'one checkbox change closes previous export immediately')
  assert.equal(current.detail, false)
  current = render(value, [])
  assert.equal(current.expanded, false, 'returning to identical old text must never resurrect consent')

  current.click()
  current = render(value, [])
  assert.equal(current.expanded, true, 'new explicit click can open the current snapshot')
  current.click()
  assert.equal(render(value, []).expanded, false, 'ordinary toggle still closes')
})

test('invalid list and changed planning cannot resurrect an earlier open text area', () => {
  const value = basket()
  const render = createLiveCopyHarness()
  render(value, []).click()
  assert.equal(render(value, []).expanded, true)

  const invalid = render({ store: null, lines: [] }, [])
  assert.equal(invalid.expanded, false)
  assert.equal(invalid.button.props.disabled, true)
  assert.equal(invalid.detail, false)
  assert.equal(render(value, []).expanded, false, 'restoring the same physical list does not auto-open')

  render(value, []).click()
  assert.equal(render(value, []).expanded, true)
  const changed = basket()
  const matched = changed.lines.find(line => line.status === 'matched')
  assert.ok(matched)
  matched.productName = 'Ander gecontroleerd winkelproduct'
  const next = render(changed, [])
  assert.equal(next.expanded, false)
  assert.equal(render(value, []).expanded, false)
})
