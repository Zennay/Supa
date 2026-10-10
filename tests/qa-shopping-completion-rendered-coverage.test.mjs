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

// Genuine React SSR of the draft #1082 component; no ShoppingListView or
// running browser integration is implied by this server-rendered contract.
const source = readFileSync(
  new URL('../src/features/shopping-list/ShoppingListCompletionBanner.tsx', import.meta.url),
  'utf8',
)
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'ShoppingListCompletionBanner.tsx',
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])
const compiledModule = { exports: {} }
const realRequire = createRequire(import.meta.url)
new Function('module', 'exports', 'require', compiled.outputText)(
  compiledModule,
  compiledModule.exports,
  (name) => name === './shoppingListCompletion.ts'
    ? { shoppingListCompletion }
    : realRequire(name),
)
const { ShoppingListCompletionBanner } = compiledModule.exports
assert.equal(typeof ShoppingListCompletionBanner, 'function')

function tuesday() {
  const basket = buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: ['Di'],
    products: m2Products,
  })
  assert.equal(basket.unresolvedLineCount, 0)
  assert.ok(basket.lines.find((line) => line.id === 'basmati-rice' && line.status === 'matched'))
  return basket
}

function render(basket, done = basket.lines.map((line) => line.id)) {
  return renderToStaticMarkup(
    React.createElement(ShoppingListCompletionBanner, { basket, doneLineIds: done }),
  )
}

test('positive genuine JSX SSR: canonical checked list is complete, partial list is in progress', () => {
  const basket = tuesday()
  const good = render(basket)
  assert.match(good, /data-shopping-progress-state="complete"/)
  assert.match(good, /role="status"/)
  assert.match(good, /aria-live="polite"/)
  assert.match(good, /Alle boodschappen afgevinkt\./)
  assert.doesNotMatch(good, /<button\b|<a\b|<input\b/)

  const partial = render(basket, [])
  assert.match(partial, /data-shopping-progress-state="in-progress"/)
  assert.doesNotMatch(partial, /Alle boodschappen afgevinkt\./)
})

test('negative genuine JSX SSR: no all-clear when pack cannot cover the demand', () => {
  const basket = tuesday()
  const broken = {
    ...basket,
    lines: basket.lines.map((line) =>
      line.id === 'basmati-rice'
        ? { ...line, requirement: { ...line.requirement, amount: 1001 } }
        : line,
    ),
  }
  const snapshot = structuredClone(broken)
  const html = render(broken)

  assert.match(html, /role="status"[^>]*aria-live="polite"/)
  assert.match(html, /data-shopping-progress-state="invalid"/)
  assert.match(html, /Voortgang niet beschikbaar/)
  assert.doesNotMatch(html, /Alle boodschappen afgevinkt\./)
  assert.deepEqual(broken, snapshot)
})

test('negative genuine JSX SSR: mismatched mass/volume units never render checked-complete copy', () => {
  const basket = tuesday()
  const broken = {
    ...basket,
    lines: basket.lines.map((line) =>
      line.id === 'basmati-rice'
        ? { ...line, pack: { ...line.pack, unit: 'l' } }
        : line,
    ),
  }
  const html = render(broken)
  assert.match(html, /data-shopping-progress-state="invalid"/)
  assert.doesNotMatch(html, /Alle boodschappen afgevinkt\./)
})
