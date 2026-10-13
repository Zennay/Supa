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
const source = readFileSync(
  new URL('../src/features/shopping-list/PrintableShoppingChecklist.tsx', import.meta.url),
  'utf8',
)
const compiled = ts.transpileModule(source, {
  fileName: 'PrintableShoppingChecklist.tsx',
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])
const mod = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  mod, mod.exports,
  (specifier) => {
    if (specifier === './printableShoppingChecklist.ts') return { preparePrintableShoppingChecklist }
    if (specifier === './PrintableShoppingChecklist.css') return {}
    return require(specifier)
  },
)
const Component = mod.exports.PrintableShoppingChecklist

function basket(products = m2Products, activeDays = m2DefaultActiveDays) {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes, activeDays, products,
  })
}

function render(value = basket()) {
  return renderToStaticMarkup(React.createElement(Component, { basket: value }))
}

test('actual TSX presents print action with accessible native button and demo trust copy', () => {
  const html = render()
  assert.match(html, /<section[^>]*aria-label="Papieren boodschappenlijst"/)
  assert.match(html, /<button[^>]*type="button"[^>]*>Print boodschappenlijst<\/button>/)
  assert.match(html, /voorbeeldgegevens/)
  assert.match(html, /Geen liveprijzen of besparingsbewijs/)
  assert.doesNotMatch(html, /€|savingsCents|priceCents|onClick=|onclick=|<script|participantKey/)
})

test('actual TSX prints one checkbox per item with honest unresolved manual choice', () => {
  const value = basket(m2Products.filter((product) => product.id !== 'chicken-400'))
  const html = render(value)
  assert.equal((html.match(/<li>/g) ?? []).length, value.lines.length)
  assert.equal((html.match(/aria-hidden="true"/g) ?? []).length, value.lines.length)
  assert.match(html, /handmatig kiezen/)
  assert.match(html, /Product nog te kiezen/)
  assert.match(html, /productkeuze nog handmatig controleren/)
  assert.doesNotMatch(html, /€|Besparing|bespaard/)
})

test('actual TSX does not print fictional items from an empty plan', () => {
  const html = render(basket(m2Products, []))
  assert.match(html, /Er staan geen boodschappen op deze lijst/)
  assert.doesNotMatch(html, /<li>|productkeuze nog handmatig/)
})

test('React escapes adversarial product/store labels rather than injecting markup', () => {
  const value = structuredClone(basket())
  value.store.name = '<script>alert(1)</script>'
  const first = value.lines.find((line) => line.status === 'matched')
  assert.ok(first)
  first.productName = '<img src=x onerror=alert(1)>'
  const html = render(value)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.doesNotMatch(html, /<script>|<img\b/)
})

test('opt-in print stylesheet gates paper visibility and offers 44px click target', () => {
  const css = readFileSync(
    new URL('../src/features/shopping-list/PrintableShoppingChecklist.css', import.meta.url),
    'utf8',
  )
  assert.match(css, /\.supa-printable-shopping__action\s*\{[\s\S]*?min-height:\s*44px;/)
  assert.match(css, /\.supa-printable-shopping__action:focus-visible/)
  assert.match(css, /@media print/)
  assert.match(css, /\.supa-printable-shopping__paper\s*\{\s*display:\s*block !important;/)
  assert.match(css, /break-inside:\s*avoid/)
})
