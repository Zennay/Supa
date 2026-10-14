import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2Products } from '../src/data/m2Fixture.ts'

// Synthetic physical quantities and mock catalogue prices. Never retailer field evidence.
test('actual Mand route displays one 350 g requirement from 0.2kg + 150g across two recipes', async () => {
  const common = { id: 'basmati-rice', label: 'Basmati rijst', query: 'basmati rijst' }
  const recipes = [
    { id: 'first', title: 'Fictieve rijst A', minutes: 10, servings: 1,
      estimatedCost: 1, tags: [], ingredients: [{ ...common, unit: 'kg', amount: 0.2 }] },
    { id: 'second', title: 'Fictieve rijst B', minutes: 10, servings: 1,
      estimatedCost: 1, tags: [], ingredients: [{ ...common, unit: 'g', amount: 150 }] },
  ]
  const plan = [{ day: 'Ma', recipeId: 'first' }, { day: 'Di', recipeId: 'second' }]
  const activeDays = ['Ma', 'Di']
  const products = m2Products.filter(p => p.id === 'basmati-1kg')
  assert.equal(products.length, 1)
  const basket = (storeId, priceCents) => buildOneStoreBasket({
    store: { id: storeId, name: storeId },
    plan, activeDays, recipes,
    products: products.map(p => ({
      ...p, id: storeId + '-rice', storeId, priceCents,
    })),
  })
  const baseline = basket('voorbeeld-winkel-a', 249)
  const candidate = basket('voorbeeld-winkel-b', 259)
  for (const b of [baseline, candidate]) {
    assert.equal(b.lines.length, 1)
    assert.deepEqual(b.lines[0].requirement, { amount: 0.35, unit: 'kg' })
    assert.equal(b.matchedLineCount, 1)
    assert.equal(b.unresolvedLineCount, 0)
    assert.equal(b.lines[0].packs, 1)
  }
  const comparison = compareFullBaskets({ baseline, candidate })
  assert.equal(comparison.claimable, true)
  assert.equal(comparison.outcome, 'worse')
  assert.equal(comparison.deltaCents, 10)

  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { BasketView } = await vite.ssrLoadModule('/src/features/basket/BasketView.tsx')
    const html = renderToStaticMarkup(createElement(BasketView, {
      basket: baseline, comparison, comparisonBaseline: baseline, comparisonCandidate: candidate,
    }))
    assert.match(html, /Basmati rijst/)
    assert.match(html, /Benodigd: 0[,.]35 kg/)
    assert.match(html, /1 verpakking/)
    assert.match(html, /10/)
    assert.doesNotMatch(html, /2 productkeuzes vragen jouw controle|productmatch is onopgelost/)
  } finally {
    await vite.close()
  }
})
