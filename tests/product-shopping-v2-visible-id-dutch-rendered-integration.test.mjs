import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'

// Joint #1805/#1809 real React SSR acceptance, generated M2 fixtures only.
function fixture() {
  return buildOneStoreBasket({
    store: m2Store, products: m2Products, plan: m2InitialPlan,
    activeDays: ['Di'], recipes: m2Recipes,
  })
}

test('product #1805/#1809: invalid blank product ID never yields actionable localized React rows', async () => {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    const { ShoppingListViewV2 } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListViewV2.tsx',
    )
    const render = (basket) => renderToStaticMarkup(
      createElement(ShoppingListViewV2, { basket }),
    )
    delete globalThis.window

    for (const blankId of ['\u115f', '\u1160', '\u3164', '\uffa0', '\u2800']) {
      const basket = fixture()
      const matched = basket.lines.find(line => line.status === 'matched')
      assert.ok(matched)
      matched.productId = blankId
      matched.pack = { ...matched.pack, amount: 1, unit: 'piece' }
      const before = structuredClone(basket)
      assert.equal(shoppingListDemandIdentity(basket), null)
      const html = render(basket)
      assert.match(html, /Boodschappenlijst/)
      assert.match(html, /Geen boodschappen voor deze planning/)
      assert.doesNotMatch(html, /class="shopping-row/)
      assert.doesNotMatch(html, /aria-pressed="true"/)
      assert.doesNotMatch(html, /\bstuks?\b/)
      assert.deepEqual(basket, before)
    }

    const valid = fixture()
    const row = valid.lines.find(line => line.status === 'matched')
    assert.ok(row)
    row.productId = '⠃⠗⠇'
    row.pack = { ...row.pack, amount: 1, unit: 'piece', count: 1 }
    const beforeValid = structuredClone(valid)
    assert.equal(typeof shoppingListDemandIdentity(valid), 'string')
    const rendered = render(valid)
    assert.match(rendered, /class="shopping-row/)
    assert.match(rendered, / × 1 stuk/)
    assert.doesNotMatch(rendered, / × 1 piece/)
    assert.deepEqual(valid, beforeValid)
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else delete globalThis.window
    await vite.close()
  }
})
