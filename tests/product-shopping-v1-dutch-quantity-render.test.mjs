import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'

// Review-only regression for the CURRENT App.tsx-routed v1 ShoppingListView.
// This does not opt in to shopping-v2 or change canonical quantity/storage keys.
test('product: routed shopping list renders Dutch piece/unknown units without changing basket evidence', async () => {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { ShoppingListView } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListView.tsx',
    )
    const render = basket => renderToStaticMarkup(
      createElement(ShoppingListView, { basket }),
    )

    const original = buildOneStoreBasket({
      store: m2Store, products: m2Products, plan: m2InitialPlan,
      activeDays: ['Di'], recipes: m2Recipes,
    })
    const matched = original.lines.find(line => line.status === 'matched')
    assert.ok(matched, 'the controlled M2 basket has a matched physical line')

    const scenarios = [
      {
        name: 'one piece',
        line: { ...matched, packs: 1, pack: { amount: 1, unit: 'piece', count: 1 } },
        expected: '1 × 1 stuk',
        canonical: 'piece',
      },
      {
        name: 'many items per pack',
        line: { ...matched, packs: 1, pack: { amount: 3, unit: 'piece', count: 1 } },
        expected: '1 × 3 stuks',
        canonical: 'piece',
      },
      {
        name: 'two one-piece packs',
        line: { ...matched, packs: 2, pack: { amount: 1, unit: 'piece', count: 1 } },
        expected: '2 × 1 stuk',
        canonical: 'piece',
      },
      {
        name: 'metric pack stays metric',
        line: { ...matched, packs: 1, pack: { amount: 500, unit: 'g', count: 1 } },
        expected: '1 × 500 g',
        canonical: 'g',
      },
      {
        name: 'unresolved unknown quantity',
        line: {
          id: 'synthetic-unresolved', ingredientLabel: 'Onzekere ingrediëntkeuze',
          status: 'unresolved', requirement: { amount: null, unit: 'unknown' },
          reasons: ['synthetic fixture'], matchScore: null,
        },
        expected: '? onbekend · handmatig kiezen',
        canonical: 'unknown',
      },
    ]
    for (const { name, line, expected, canonical } of scenarios) {
      const basket = {
        ...original,
        lines: [line],
        matchedLineCount: line.status === 'matched' ? 1 : 0,
        unresolvedLineCount: line.status === 'unresolved' ? 1 : 0,
      }
      const before = structuredClone(basket)
      const html = render(basket)
      assert.ok(html.includes(expected), `${name}: expected Dutch visible quantity in ${html}`)
      assert.doesNotMatch(html, /\bpiece\b|\bunknown\b/)
      assert.equal(line.status === 'matched' ? line.pack.unit : line.requirement.unit, canonical)
      assert.deepEqual(basket, before, `${name}: rendering must not mutate canonical demand`)
    }
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else delete globalThis.window
    await vite.close()
  }
})
