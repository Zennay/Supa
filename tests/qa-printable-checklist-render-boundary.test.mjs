import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { preparePrintableShoppingChecklist } from '../src/features/shopping-list/printableShoppingChecklist.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const source = readFileSync(new URL('../src/features/shopping-list/PrintableShoppingChecklist.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/features/shopping-list/PrintableShoppingChecklist.css', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: 'PrintableShoppingChecklist.tsx',
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])
const moduleRecord = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  moduleRecord, moduleRecord.exports,
  (name) => {
    if (name === './printableShoppingChecklist.ts') return { preparePrintableShoppingChecklist }
    if (name === './PrintableShoppingChecklist.css') return {}
    return require(name)
  },
)
const Component = moduleRecord.exports.PrintableShoppingChecklist

function makeBasket() {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products: m2Products,
  })
}
function render(basket) {
  return renderToStaticMarkup(React.createElement(Component, { basket }))
}

test('actual React print projection preserves 22 independently keyed physical rows and one trust disclaimer', () => {
  const value = structuredClone(makeBasket())
  value.lines = [...value.lines, ...value.lines.map((row) => ({ ...row, id: `copy-${row.id}` }))]
  const html = render(value)
  assert.equal((html.match(/<li>/g) ?? []).length, value.lines.length)
  assert.equal((html.match(/aria-hidden="true"/g) ?? []).length, value.lines.length)
  assert.equal((html.match(/Geen liveprijzen of besparingsbewijs/g) ?? []).length, 1)
  assert.equal((html.match(/Print boodschappenlijst/g) ?? []).length, 1)
  assert.doesNotMatch(html, /priceCents|totalCents|savingsCents|participantKey|observedAt|<script|onClick=|onclick=/)
})

test('independent rendered manual-review note reconciles to exact unresolved row count', () => {
  const value = structuredClone(makeBasket())
  for (const row of value.lines.slice(0, 3)) {
    row.status = 'unresolved'
    row.requirement = { amount: null, unit: 'unknown' }
  }
  const expected = preparePrintableShoppingChecklist(value)
  assert.ok(expected.reviewCount >= 3)
  const html = render(value)
  assert.match(html, new RegExp(`${expected.reviewCount} productkeuzes nog handmatig controleren`))
  assert.equal((html.match(/Product nog te kiezen/g) ?? []).length, expected.reviewCount)
  assert.equal((html.match(/handmatig kiezen/g) ?? []).length, expected.reviewCount)
  assert.doesNotMatch(html, /€|bespaard|<script|<input[^>]+value=/)
})

test('Unicode and HTML-special product/store labels are rendered as inert text, not markup', () => {
  const value = structuredClone(makeBasket())
  value.store.name = 'Winkel <b>& Veilig</b>'
  const matched = value.lines.find((row) => row.status === 'matched')
  assert.ok(matched)
  matched.productName = 'Havermout <img src=x onerror=alert(1)> & cafés ☕'
  const html = render(value)
  assert.match(html, /Winkel &lt;b&gt;&amp; Veilig&lt;\/b&gt;/)
  assert.match(html, /Havermout &lt;img src=x onerror=alert\(1\)&gt; &amp; cafés ☕/)
  assert.doesNotMatch(html, /<img\b|<b>|<script|onerror=/i) // escaped markup contains textual onerror; check actual tags below
})

test('print-only stylesheet, native print trigger and real visible action are gated to the opt-in subtree', () => {
  const html = render(makeBasket())
  assert.match(html, /<section[^>]*class="supa-printable-shopping"[^>]*aria-label="Papieren boodschappenlijst"/)
  assert.match(html, /<button[^>]*type="button"[^>]*class="supa-printable-shopping__action"/)
  assert.match(css, /\.supa-printable-shopping__paper\s*\{\s*display:\s*none;/)
  assert.match(css, /@media print\s*\{/)
  assert.match(css, /\.supa-printable-shopping__paper\s*\{\s*display:\s*block !important;/)
  assert.match(css, /body:has\(\.supa-printable-shopping\)/)
  assert.match(css, /\.supa-printable-shopping__action\s*\{[\s\S]*?min-height:\s*44px;/)
  assert.match(css, /\.supa-printable-shopping__action:focus-visible/)
  assert.match(source, /typeof window !== 'undefined'\) window\.print\(\)/)
})
