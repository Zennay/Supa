import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { preparePrintableShoppingChecklist } from '../src/features/shopping-list/printableShoppingChecklist.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const printerSource = readFileSync(
  new URL('../src/features/shopping-list/PrintableShoppingChecklist.tsx', import.meta.url), 'utf8',
)
const routedSource = readFileSync(
  new URL('../src/features/shopping-list/ShoppingListView.tsx', import.meta.url), 'utf8',
)
const compiled = ts.transpileModule(printerSource, {
  fileName: 'PrintableShoppingChecklist.tsx',
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])
const localModule = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  localModule, localModule.exports,
  (name) => {
    if (name === './printableShoppingChecklist.ts') return { preparePrintableShoppingChecklist }
    if (name === './PrintableShoppingChecklist.css') return {}
    return require(name)
  },
)
const PrintableShoppingChecklist = localModule.exports.PrintableShoppingChecklist

function basket() {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products: m2Products,
  })
}

function render(value, doneLineIds) {
  return renderToStaticMarkup(
    React.createElement(PrintableShoppingChecklist, { basket: value, doneLineIds }),
  )
}

test('product print reflects the currently checked physical line without altering other rows', () => {
  const value = basket()
  const lines = preparePrintableShoppingChecklist(value).lines
  assert.ok(lines.length > 1)
  const before = structuredClone(value)
  const html = render(value, [lines[0].id])
  assert.equal((html.match(/☑/g) ?? []).length, 1)
  assert.equal((html.match(/☐/g) ?? []).length, lines.length - 1)
  assert.equal((html.match(/<li>/g) ?? []).length, lines.length)
  assert.match(html, /Geen liveprijzen of besparingsbewijs/)
  assert.doesNotMatch(html, /€|savingsCents|priceCents|lineTotalCents/)
  assert.deepEqual(value, before)
})

test('print never trusts foreign, duplicate or malformed completed IDs', () => {
  const value = basket()
  const lines = preparePrintableShoppingChecklist(value).lines
  assert.ok(lines.length > 1)
  const html = render(value, [lines[1].id, lines[1].id, 'other-basket-line', null, 17])
  assert.equal((html.match(/☑/g) ?? []).length, 1)
  assert.equal((html.match(/☐/g) ?? []).length, lines.length - 1)
  const corrupted = render(value, { arbitrary: 'not-an-array' })
  assert.equal((corrupted.match(/☑/g) ?? []).length, 0)
  assert.equal((corrupted.match(/☐/g) ?? []).length, lines.length)
})

test('print without checklist progress starts with blank boxes and preserves manual-review rows', () => {
  const value = structuredClone(basket())
  const first = value.lines[0]
  first.status = 'unresolved'
  const lines = preparePrintableShoppingChecklist(value).lines
  const html = render(value, undefined)
  assert.equal((html.match(/☑/g) ?? []).length, 0)
  assert.equal((html.match(/☐/g) ?? []).length, lines.length)
  assert.match(html, /Product nog te kiezen/)
  assert.doesNotMatch(html, /€|bespaard/)
})

test('real shopping route forwards only its currently valid checked state into the print view', () => {
  assert.match(
    routedSource,
    /<PrintableShoppingChecklist\s+basket=\{basket\}\s+doneLineIds=\{done\}\s*\/>/,
  )
  assert.match(routedSource, /const done = progress\.basketKey === basketKey \? progress\.done : \[\]/)
  assert.doesNotMatch(printerSource, /localStorage|fetch\(|clipboard|writeFile|setItem/)
})
