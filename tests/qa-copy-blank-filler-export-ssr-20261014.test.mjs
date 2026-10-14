import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'
import { preparePrintableShoppingChecklist } from '../src/features/shopping-list/printableShoppingChecklist.ts'

// Non-overlapping independent QA: real routed React SSR + portable/print
// consistency, on frozen product-core #2587. No new retailer observations.
const BLANK = ['\u115f', '\u1160', '\u3164', '\uffa0', '\u2800']
const BLANK_PATTERN = /[\u115f\u1160\u3164\uffa0\u2800]/u
function demo() {
  // The canonical fixture's store may be frozen. Clone only controlled QA data
  // before changing synthetic names; never mutate the shared catalogue.
  return structuredClone(buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products: m2Products,
  }))
}
const initial = demo()
const selected = initial.lines.findIndex(line => line.status === 'matched')
assert.ok(selected >= 0)
function matchedAsBlank(field, glyph) {
  const value = demo()
  value.lines[selected][field] = glyph
  return value
}

test('QA filler: copied matched purchase refuses 5 hidden glyphs while paper demands manual verification', () => {
  for (const glyph of BLANK) {
    const value = matchedAsBlank('productName', glyph)
    const before = structuredClone(value)
    assert.equal(buildShoppingListCopyText(value), null)
    const paper = preparePrintableShoppingChecklist(value)
    assert.equal(paper.lines[selected].needsReview, true)
    assert.match(paper.lines[selected].quantity, /handmatig kiezen/)
    assert.match(paper.lines[selected].label, /\S/u)
    assert.equal(paper.reviewCount >= 1, true)
    assert.deepEqual(value, before)
  }
})

test('QA filler: unresolved ingredients with hidden names cannot become a portable task', () => {
  for (const glyph of BLANK) {
    const value = demo()
    const line = value.lines[selected]
    line.status = 'unresolved'
    line.requirement = { amount: null, unit: 'unknown' }
    line.ingredientLabel = glyph
    value.matchedLineCount -= 1
    value.unresolvedLineCount += 1
    const original = structuredClone(value)
    assert.equal(buildShoppingListCopyText(value), null)
    const paper = preparePrintableShoppingChecklist(value)
    assert.equal(paper.lines[selected].needsReview, true)
    assert.equal(paper.lines[selected].label, 'Onbekend ingrediënt')
    assert.match(paper.lines[selected].quantity, /handmatig kiezen/)
    assert.deepEqual(value, original)
  }
})

test('QA filler: active store label cannot be hidden in portable export or print heading', () => {
  for (const glyph of BLANK) {
    const value = demo()
    value.store.name = glyph
    assert.equal(buildShoppingListCopyText(value), null)
    assert.equal(preparePrintableShoppingChecklist(value).storeLabel, 'Winkel nog te kiezen')
  }
})

test('QA filler: valid Dutch text with embedded invisible filler remains readable in both paths', () => {
  const value = demo()
  value.store.name = 'Voorbeeld\u115f winkel'
  value.lines[selected].productName = 'Basmati\u2800 rijst'
  value.lines[selected].ingredientLabel = 'Rijst\u3164korrels'
  const before = structuredClone(value)
  const plain = buildShoppingListCopyText(value, [value.lines[selected].id])
  assert.ok(plain)
  assert.match(plain, /Boodschappenlijst — Voorbeeld winkel/u)
  assert.match(plain, /\[x\] Basmati rijst/u)
  assert.doesNotMatch(plain, BLANK_PATTERN)
  const paper = preparePrintableShoppingChecklist(value)
  assert.equal(paper.lines[selected].needsReview, false)
  assert.equal(paper.lines[selected].label, 'Basmati rijst')
  assert.equal(paper.storeLabel, 'Voorbeeld winkel')
  assert.doesNotMatch(plain, /€|besparing|prijsverschil/iu)
  assert.deepEqual(value, before)
})

test('QA filler: routed SSR hides selectable copy for all five blank-only product and store labels', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { ShoppingListView } = await vite.ssrLoadModule('/src/features/shopping-list/ShoppingListView.tsx')
    for (const glyph of BLANK) {
      for (const broken of ['store.name', 'productName']) {
        const value = broken === 'store.name' ? demo() : matchedAsBlank('productName', glyph)
        if (broken === 'store.name') value.store.name = glyph
        const html = renderToStaticMarkup(createElement(ShoppingListView, { basket: value }))
        assert.match(html, /class="shopping-copy__button" disabled=""/u,
          'invisible-only ' + broken + ' must disable portable export')
        assert.match(html, /nog niet veilig worden gekopieerd/u)
        assert.doesNotMatch(html, /<textarea|€|priceCents|savingsCents|<script\b/iu)
        if (broken === 'store.name') assert.match(html, /Winkel nog te kiezen/u)
        else assert.match(html, /Product nog te kiezen/u)
      }
    }
  } finally {
    await vite.close()
  }
})
