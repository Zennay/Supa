import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { isTrustworthyShoppingBasket } from '../src/features/shopping-list/shoppingListPhysicalValidity.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'
import {
  reconcileTrustedShoppingProgressV2, restoreTrustedShoppingProgressV2,
  serializeTrustedShoppingProgressV2, toggleTrustedShoppingProgressV2,
  upgradeTrustedLegacyProgressV1,
} from '../src/features/shopping-list/shoppingListTrustedProgressV2.ts'
import { shoppingListProgressStorageKey } from '../src/features/shopping-list/shoppingListProgress.ts'
import { shoppingListCompletion } from '../src/features/shopping-list/shoppingListCompletion.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'

// Full component composition, not a hand-written parallel renderer:
// execute the actual production TSX of the parent, banner and copy control.
// This independent SSR proof does not replace real Firefox/mobile interaction.
const require = createRequire(import.meta.url)
function component(file, imports) {
  const source = readFileSync(
    new URL('../src/features/shopping-list/' + file, import.meta.url), 'utf8',
  )
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: file,
    reportDiagnostics: true,
  })
  assert.deepEqual(compiled.diagnostics, [])
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, name => Object.hasOwn(imports, name)
      ? imports[name] : require(name),
  )
  return module.exports
}

const { ShoppingListCompletionBanner } = component('ShoppingListCompletionBanner.tsx', {
  './shoppingListCompletion.ts': { shoppingListCompletion },
})
const { ShoppingListCopyButton } = component('ShoppingListCopyButton.tsx', {
  './shoppingListCopyText': { buildShoppingListCopyText },
  './shoppingListCopyButton.css': {},
})
const { ShoppingListView } = component('ShoppingListView.tsx', {
  './shoppingListDemandIdentity.ts': { shoppingListDemandIdentity },
  './shoppingListPhysicalValidity.ts': { isTrustworthyShoppingBasket },
  './shoppingListProgressV2.ts': { shoppingListProgressV2StorageKey },
  './shoppingListTrustedProgressV2.ts': {
    reconcileTrustedShoppingProgressV2, restoreTrustedShoppingProgressV2,
    serializeTrustedShoppingProgressV2, toggleTrustedShoppingProgressV2,
    upgradeTrustedLegacyProgressV1,
  },
  './shoppingListProgress': { shoppingListProgressStorageKey },
  './ShoppingListCompletionBanner.tsx': { ShoppingListCompletionBanner },
  './ShoppingListCopyButton.tsx': { ShoppingListCopyButton },
})

function basket(activeDays = m2DefaultActiveDays) {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays, products: m2Products,
  })
}
function render(current) {
  return renderToStaticMarkup(
    React.createElement(ShoppingListView, { basket: current }),
  )
}

test('full live shopping view renders actual native copy control beside actual completion banner', () => {
  const current = basket()
  assert.equal(isTrustworthyShoppingBasket(current), true)
  const html = render(current)
  assert.match(html, /<h2>Boodschappenlijst<\/h2>/)
  assert.match(html, /data-shopping-progress-state="(in-progress|review-needed)"/)
  assert.match(html, /Toon kopieerbare lijst/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /aria-controls="[^"]+"/)
  assert.doesNotMatch(html, /<textarea|Bespaard|besparingsclaim|navigator\.clipboard/)
})

test('full live shopping view denies copy on forged cent-total even with plausible lines', () => {
  const current = basket()
  const forged = { ...current, totalCents: current.totalCents + 1 }
  assert.equal(isTrustworthyShoppingBasket(forged), false)
  const html = render(forged)
  assert.match(html, /De boodschappenlijst kan nog niet veilig worden gekopieerd/)
  assert.doesNotMatch(html, /Toon kopieerbare lijst|<textarea/)
  assert.match(html, /data-shopping-progress-state="invalid"/)
})

test('full live shopping view denies copy when a pack is physically invalid', () => {
  const invalid = structuredClone(basket())
  const matched = invalid.lines.find(line => line.status === 'matched')
  assert.ok(matched)
  matched.pack.count = 0
  assert.equal(isTrustworthyShoppingBasket(invalid), false)
  const html = render(invalid)
  assert.match(html, /De boodschappenlijst kan nog niet veilig worden gekopieerd/)
  assert.doesNotMatch(html, /Toon kopieerbare lijst|<textarea/)
})

test('empty planned week remains safely readable without inventing products or money', () => {
  const empty = basket([])
  assert.equal(isTrustworthyShoppingBasket(empty), true)
  const html = render(empty)
  assert.match(html, /data-shopping-progress-state="empty"/)
  assert.match(html, /Toon kopieerbare lijst/)
  assert.doesNotMatch(html, /<textarea|Besparing|€/)
})
