import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'

// Exercise the real React component, not a copied template. No HTTP,
// browser storage, retailer scraping, receipts, participant data or live prices.
const base = buildOneStoreBasket({
  store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
  products: m2Products, activeDays: m2DefaultActiveDays,
})
const rowIndex = base.lines.findIndex(line => line.status === 'matched')
assert.ok(rowIndex >= 0)

function syntheticBasket(requirement, pack, packs) {
  const basket = structuredClone(base)
  const line = basket.lines[rowIndex]
  line.requirement = requirement
  line.pack = { ...pack, count: 1 }
  line.packs = packs
  line.productName = 'Fictief afdrukcontroleartikel'
  return basket
}

test('independent React SSR: paper reflects exact metric pack ceilings and refuses stale packs', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  try {
    const { PrintableShoppingChecklist } = await vite.ssrLoadModule(
      '/src/features/shopping-list/PrintableShoppingChecklist.tsx',
    )
    const samples = [
      // Exact decimal values deliberately cross the gram/kilogram boundary.
      [{ amount: 0.3, unit: 'g' }, { amount: 0.1, unit: 'g' }, 3, '3 × 0,1 g', false],
      [{ amount: 0.3, unit: 'g' }, { amount: 0.0001, unit: 'kg' }, 3, '3 × 0,0001 kg', false],
      [{ amount: 0.35, unit: 'l' }, { amount: 175, unit: 'ml' }, 2, '2 × 175 ml', false],
      [{ amount: 0.3, unit: 'g' }, { amount: 0.1, unit: 'g' }, 4, '0,3 g · handmatig kiezen', true],
      [{ amount: 0.3, unit: 'kg' }, { amount: 100, unit: 'g' }, 2, '0,3 kg · handmatig kiezen', true],
      [{ amount: 0.35, unit: 'l' }, { amount: 175, unit: 'g' }, 2, '0,35 l · handmatig kiezen', true],
    ]
    for (const [requirement, pack, packs, expected, review] of samples) {
      const basket = syntheticBasket(requirement, pack, packs)
      const snapshot = structuredClone(basket)
      const html = renderToStaticMarkup(createElement(PrintableShoppingChecklist, { basket }))
      assert.deepEqual(basket, snapshot, 'SSR cannot modify the shopping source')
      assert.match(html, /aria-label="Papieren boodschappenlijst"/)
      assert.match(html, /<button[^>]*type="button"/)
      assert.ok(html.includes(expected), `paper quantity missing: ${expected}`)
      assert.match(html, /Fictief afdrukcontroleartikel|handmatig kiezen/)
      assert.equal(html.includes('0,3 g · handmatig kiezen') ||
        html.includes('0,3 kg · handmatig kiezen') ||
        html.includes('0,35 l · handmatig kiezen'), review,
      'incorrect physical purchase count must never print as a trusted pack')
      assert.doesNotMatch(html, /€|priceCents|savingsCents|publicSavingsClaimEligible|<script\b|<iframe\b/)
      assert.match(html, /Geen liveprijzen of besparingsbewijs/)
    }
  } finally {
    await vite.close()
  }
})
