import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'

test('real routed Lijst exposes safe optional manual copy with no automatic clipboard write', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const component = await readFile(new URL('../src/features/shopping-list/ShoppingListView.tsx', import.meta.url), 'utf8')
  const copy = await readFile(new URL('../src/features/shopping-list/ShoppingListCopyButton.tsx', import.meta.url), 'utf8')
  const css = await readFile(new URL('../src/features/shopping-list/shoppingListCopyButton.css', import.meta.url), 'utf8')
  assert.match(app, /ShoppingListView basket=\{basket\}/)
  assert.match(component, /<ShoppingListCopyButton basket=\{basket\} doneLineIds=\{done\} \/>/)
  assert.doesNotMatch(copy, /navigator\.clipboard|document\.execCommand|fetch\(/)
  assert.match(css, /min-height:\s*44px/)

  const vite = await createServer({
    server: { middlewareMode: true, hmr: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { ShoppingListView } = await vite.ssrLoadModule('/src/features/shopping-list/ShoppingListView.tsx')
    const basket = buildOneStoreBasket({
      store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
      products: m2Products, activeDays: ['Di'],
    })
    const original = structuredClone(basket)
    const html = renderToStaticMarkup(createElement(ShoppingListView, { basket }))
    assert.match(html, /Toon kopieerbare lijst/)
    assert.match(html, /aria-expanded="false"/)
    assert.doesNotMatch(html, /<textarea\b|Besparing|prijsverschil/)
    assert.match(html, /class="shopping-row/)
    assert.deepEqual(basket, original)
    const text = buildShoppingListCopyText(basket)
    assert.ok(text && text.startsWith('Boodschappenlijst'))
    assert.match(text, /\[ \]/)
    assert.doesNotMatch(text, /€|besparing|liveprijs|prijsverschil/i)
    const invalid = renderToStaticMarkup(createElement(ShoppingListView, {
      basket: { ...basket, matchedLineCount: 100000 },
    }))
    assert.match(invalid, /De boodschappenlijst kan nog niet veilig worden gekopieerd/)
    assert.doesNotMatch(invalid, /<textarea\b/)
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else delete globalThis.window
    await vite.close()
  }
})
