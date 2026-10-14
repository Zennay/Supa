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

const require = createRequire(import.meta.url)
const tsx = readFileSync(
  new URL('../src/features/shopping-list/ShoppingListCompletionBanner.tsx', import.meta.url),
  'utf8',
)

const compiled = ts.transpileModule(tsx, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'ShoppingListCompletionBanner.tsx',
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])
const module = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  module,
  module.exports,
  (specifier) => specifier === './shoppingListCompletion.ts'
    ? { shoppingListCompletion }
    : require(specifier),
)
const { ShoppingListCompletionBanner } = module.exports

function basket(activeDays = ['Ma']) {
  return buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    activeDays,
    recipes: m2Recipes,
    products: m2Products,
  })
}

function render(value, checked) {
  return renderToStaticMarkup(
    React.createElement(ShoppingListCompletionBanner, {
      basket: value,
      doneLineIds: checked,
    }),
  )
}

test('actual React SSR announces current checklist progress without milestones or monetary claims', () => {
  const value = basket()
  const html = render(value, [])
  assert.match(html, /role="status"/)
  assert.match(html, /aria-live="polite"/)
  assert.match(html, /data-shopping-progress-state="in-progress"/)
  assert.match(html, /boodschappen afgevinkt/)
  assert.doesNotMatch(html, /M2|M3|bespaar|besparing|prijsverschil|€|claimable/i)
})

test('rendered checked unresolved products cannot be presented as fully complete', () => {
  const value = basket()
  const ids = value.lines.map((line) => line.id)
  const html = render(value, ids)
  if (value.unresolvedLineCount > 0) {
    assert.match(html, /data-shopping-progress-state="review-needed"/)
    assert.match(html, /productkeuze/)
    assert.doesNotMatch(html, /Alle boodschappen afgevinkt\./)
  }
})

test('empty week and invalid basket render safe passive messaging with no controls', () => {
  const empty = render(basket([]), [])
  assert.match(empty, /data-shopping-progress-state="empty"/)
  assert.match(empty, /Geen boodschappenregels/)
  const invalid = render({ ...basket([]), matchedLineCount: -1 }, [])
  assert.match(invalid, /data-shopping-progress-state="invalid"/)
  assert.match(invalid, /Voortgang niet beschikbaar/)
  for (const html of [empty, invalid]) {
    assert.doesNotMatch(html, /<button\b|<input\b|<a\b/)
  }
})

test('repeated rendering remains deterministic and never reveals injected product labels', () => {
  const original = basket()
  const value = {
    ...original,
    lines: original.lines.map((line, index) =>
      index === 0
        ? { ...line, ingredientLabel: 'SECRET_MARKER_DO_NOT_EXPOSE' }
        : line,
    ),
  }
  const snapshot = JSON.stringify(value)
  const checked = [value.lines[0].id]
  const first = render(value, checked)
  for (let i = 0; i < 4; i += 1) assert.equal(render(value, checked), first)
  assert.equal(JSON.stringify(value), snapshot)
  assert.doesNotMatch(first, /SECRET_MARKER_DO_NOT_EXPOSE/)
})
