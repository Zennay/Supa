import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListCompletion } from '../src/features/shopping-list/shoppingListCompletion.ts'

// The banner is a draft #1082 component, not yet integrated in ShoppingListView.
// Exercise genuine React SSR, not a mocked JSX string or a live-browser claim.
const source = readFileSync(
  new URL('../src/features/shopping-list/ShoppingListCompletionBanner.tsx', import.meta.url),
  'utf8',
)
const transformed = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'ShoppingListCompletionBanner.tsx',
  reportDiagnostics: true,
})
assert.deepEqual(transformed.diagnostics, [])
const module = { exports: {} }
const require = createRequire(import.meta.url)
new Function('module', 'exports', 'require', transformed.outputText)(
  module,
  module.exports,
  (specifier) => specifier === './shoppingListCompletion.ts'
    ? { shoppingListCompletion }
    : require(specifier),
)
const { ShoppingListCompletionBanner } = module.exports

function basket() {
  return buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: ['Di'],
    products: m2Products,
  })
}
function render(value) {
  return renderToStaticMarkup(React.createElement(ShoppingListCompletionBanner, {
    basket: value,
    doneLineIds: value.lines.map((line) => line.id),
  }))
}

test('React SSR: canonical completed Tuesday renders passive checked progress', () => {
  const html = render(basket())
  assert.match(html, /role="status"/)
  assert.match(html, /data-shopping-progress-state="complete"/)
  assert.match(html, /Alle boodschappen afgevinkt\./)
  assert.doesNotMatch(html, /<button\b|<input\b|besparing|€/)
})

test('React SSR: missing, fractional or non-finite totals never render the all-done claim', async (t) => {
  const original = basket()
  for (const [name, totalCents] of [
    ['undefined', undefined],
    ['fractional', original.totalCents + 0.5],
    ['NaN', Number.NaN],
    ['Infinity', Infinity],
  ]) {
    await t.test(name, () => {
      const altered = { ...original, totalCents }
      const snapshot = structuredClone(altered)
      const html = render(altered)
      assert.match(html, /role="status"/)
      assert.match(html, /aria-live="polite"/)
      assert.match(html, /data-shopping-progress-state="invalid"/)
      assert.match(html, /Voortgang niet beschikbaar/)
      assert.doesNotMatch(html, /Alle boodschappen afgevinkt\.|besparing|€/)
      assert.deepEqual(altered, snapshot)
    })
  }
})
