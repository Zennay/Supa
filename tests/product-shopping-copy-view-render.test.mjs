import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'

// Execute the ACTUAL selectable-copy component in React SSR. No clipboard or
// browser globals are needed, and no synthetic prices are labelled as live.
const require = createRequire(import.meta.url)
const source = readFileSync(
  new URL('../src/features/shopping-list/ShoppingListCopyButton.tsx', import.meta.url),
  'utf8',
)
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'ShoppingListCopyButton.tsx',
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])
const componentModule = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  componentModule, componentModule.exports, name => {
    if (name === './shoppingListCopyText') return { buildShoppingListCopyText }
    if (name === './shoppingListCopyButton.css') return {}
    return require(name)
  },
)
const { ShoppingListCopyButton } = componentModule.exports

function basket() {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products: m2Products,
  })
}
function render(current, doneLineIds = []) {
  return renderToStaticMarkup(
    React.createElement(ShoppingListCopyButton, { basket: current, doneLineIds }),
  )
}

test('real React copy control offers explicit, labelled native user-driven selection', () => {
  const current = basket()
  const html = render(current, [current.lines[0].id])
  assert.match(html, /type="button"/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /aria-controls="[^"]+"/)
  assert.match(html, /Toon kopieerbare lijst/)
  assert.doesNotMatch(html, /disabled=""/)
  assert.doesNotMatch(html, /<textarea|€|besparingsclaim|navigator\.clipboard/)
})

test('real React copy control disables misleading export for corrupt physical demand', () => {
  const current = basket()
  const invalid = { ...current, lines: {} }
  const html = render(invalid)
  assert.match(html, /disabled=""/)
  assert.match(html, /De boodschappenlijst kan nog niet veilig worden gekopieerd/)
  assert.doesNotMatch(html, /<textarea|\[x\]|€/)
})

test('current checked IDs affect text only, not the physical basket or the price', () => {
  const current = basket()
  const before = structuredClone(current)
  const itemId = current.lines[0].id
  const unchecked = buildShoppingListCopyText(current, [])
  const checked = buildShoppingListCopyText(current, [itemId])
  assert.ok(unchecked)
  assert.ok(checked)
  assert.notEqual(unchecked, checked)
  assert.equal(checked.split('\n').filter(line => line.startsWith('[x]')).length, 1)
  assert.doesNotMatch(checked, /€|besparing|prijsverschil/i)
  assert.deepEqual(current, before)
})
