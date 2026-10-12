import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'

function fixture(activeDays = ['Di']) {
  return buildOneStoreBasket({
    store: { ...m2Store }, plan: m2InitialPlan, recipes: m2Recipes,
    products: m2Products, activeDays,
  })
}

test('invalid physical shopping data must never be misrepresented as a genuinely empty plan', async () => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    const { ShoppingListViewV2 } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListViewV2.tsx',
    )
    delete globalThis.window
    const render = (basket) => renderToStaticMarkup(createElement(ShoppingListViewV2, { basket }))

    const empty = fixture([])
    assert.equal(empty.lines.length, 0)
    assert.equal(typeof shoppingListDemandIdentity(empty), 'string')
    const emptyBefore = structuredClone(empty)
    const emptyHtml = render(empty)
    assert.match(emptyHtml, /Geen boodschappen voor deze planning/)
    assert.doesNotMatch(emptyHtml, /Boodschappenlijst niet beschikbaar/)
    assert.deepEqual(empty, emptyBefore)

    const invalidCases = [
      ['store title', (subject) => { subject.store.name = '\u2800' }],
      ['missing ingredient label', (subject) => { subject.lines[0].ingredientLabel = null }],
      ['blank product id', (subject) => {
        const line = subject.lines.find(entry => entry.status === 'matched')
        assert.ok(line)
        line.productId = '\u1160'
      }],
      ['non-finite requirement', (subject) => { subject.lines[0].requirement.amount = Number.NaN }],
    ]
    for (const [caseName, mutate] of invalidCases) {
      const subject = fixture()
      mutate(subject)
      const before = structuredClone(subject)
      assert.equal(shoppingListDemandIdentity(subject), null, caseName)
      const html = render(subject)
      assert.match(html, /Boodschappenlijst niet beschikbaar/, caseName)
      assert.match(html, /Controleer je planning/, caseName)
      assert.doesNotMatch(html, /Geen boodschappen voor deze planning/, caseName)
      assert.doesNotMatch(html, /class="shopping-row/, caseName)
      assert.deepEqual(subject, before, caseName)
    }
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else delete globalThis.window
    await vite.close()
  }
})
