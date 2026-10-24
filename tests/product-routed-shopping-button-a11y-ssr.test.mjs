import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Recipes, m2Products, m2Store } from '../src/data/m2Fixture.ts'

test('shopping rows announce toggle state instead of relying on glyph alone', async () => {
  const source = await readFile(new URL('../src/features/shopping-list/ShoppingListView.tsx', import.meta.url), 'utf8')
  assert.match(source, /aria-pressed=\{checked\}/)
  assert.match(source, /className="check" aria-hidden="true"/)

  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { ShoppingListView } = await vite.ssrLoadModule('/src/features/shopping-list/ShoppingListView.tsx')
    const basket = buildOneStoreBasket({
      store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
      products: m2Products, activeDays: ['Di'],
    })
    const original = structuredClone(basket)
    const html = renderToStaticMarkup(createElement(ShoppingListView, { basket }))
    const buttons = [...html.matchAll(/<button\b[^>]*class="shopping-row[^"]*"[^>]*>/g)].map(x => x[0])
    assert.equal(buttons.length, basket.lines.length)
    assert.ok(buttons.length > 0)
    for (const button of buttons) {
      assert.match(button, /type="button"/)
      assert.match(button, /aria-pressed="false"/)
      assert.doesNotMatch(button, /type="submit"/)
    }
    assert.equal((html.match(/class="check" aria-hidden="true"/g) || []).length, basket.lines.length)
    assert.deepEqual(basket, original)
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
    await vite.close()
  }
})
