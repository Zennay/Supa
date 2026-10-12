import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'

// Read-only product acceptance on the frozen v1 Dutch-quantity proposal.
// Pack and product data are controlled examples, never observed retailer prices.
test('product: shopping-v1 localizes piece multipacks while keeping physical quantities price-independent', async () => {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const existingWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { ShoppingListView } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListView.tsx',
    )
    const original = buildOneStoreBasket({
      store: m2Store, products: m2Products, plan: m2InitialPlan,
      activeDays: ['Di'], recipes: m2Recipes,
    })
    const matched = original.lines.find(line => line.status === 'matched')
    assert.ok(matched, 'controlled M2 fixture must contain a matched shopping row')

    const scenarios = [
      { packs: 2, pack: { count: 6, amount: 1, unit: 'piece' }, label: '2 × 6 × 1 stuk' },
      { packs: 1, pack: { count: 2, amount: 3, unit: 'piece' }, label: '1 × 2 × 3 stuks' },
      { packs: 2, pack: { count: 1, amount: 0.5, unit: 'kg' }, label: '2 × 0.5 kg' },
      { packs: 1, pack: { count: 4, amount: 250, unit: 'ml' }, label: '1 × 4 × 250 ml' },
    ]
    for (const { packs, pack, label } of scenarios) {
      const line = { ...matched, packs, pack }
      const basket = {
        ...original, lines: [line], matchedLineCount: 1, unresolvedLineCount: 0,
      }
      const before = structuredClone(basket)
      const render = value => renderToStaticMarkup(createElement(ShoppingListView, { basket: value }))
      const displayed = render(basket)
      const repricedLine = {
        ...line,
        pricePerPackCents: 299,
        lineTotalCents: 299 * packs,
      }
      const repriced = { ...basket, lines: [repricedLine] }
      const beforeRepriced = structuredClone(repriced)
      const repricedHtml = render(repriced)

      assert.ok(displayed.includes(label), `expected ${label} in ${displayed}`)
      assert.ok(repricedHtml.includes(label), 'changing only money must not change physical label')
      assert.doesNotMatch(displayed, /\\bpiece\\b|\\bunknown\\b/)
      assert.doesNotMatch(repricedHtml, /\\bpiece\\b|\\bunknown\\b/)
      assert.equal(line.pack.unit, pack.unit, 'canonical unit must remain untouched')
      assert.equal(repricedLine.pack.unit, pack.unit, 'repricing must not localize data')
      assert.deepEqual(basket, before)
      assert.deepEqual(repriced, beforeRepriced)
    }
  } finally {
    if (existingWindow) Object.defineProperty(globalThis, 'window', existingWindow)
    else delete globalThis.window
    await vite.close()
  }
})
