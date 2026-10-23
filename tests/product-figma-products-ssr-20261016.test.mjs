import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('actual Figma Producten defaults to historical source identities without publishing prices', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { HiFiHome } = await vite.ssrLoadModule('/src/features/home/HiFiHome.tsx')
    const { historicalRetailerProducts, filterHistoricalProducts } = await vite.ssrLoadModule('/src/features/products/historicalRetailerProducts.ts')
    const html = renderToStaticMarkup(createElement(HiFiHome, {
      view: 'products', addedProducts: [], activeDays: [],
      onNavigate() { assert.fail('SSR should not navigate') },
      onToggleProduct() { assert.fail('SSR should not mutate') },
    }))
    assert.match(html, /data-figma-node="3064:3125"/)
    assert.match(html, /<h1 class="hifi-page-title">Producten<\/h1>/)
    assert.match(html, /Zoek producten/)
    assert.match(html, /Bronwaarnemingen/)
    assert.match(html, /Figma voorbeelden/)
    assert.match(html, /PLUS Bananen Fairtrade/)
    assert.match(html, /Zuivelmeester Halfvolle melk/)
    assert.match(html, /DekaMarkt/)
    assert.match(html, /Bron: PLUS/)
    assert.match(html, /Prijs niet vrijgegeven/)
    assert.match(html, /Niet actueel, nog niet gelicentieerd voor productie/)
    assert.equal(historicalRetailerProducts.length, 5)
    assert.equal((html.match(/data-product-source="historical"/g) ?? []).length, 5)
    assert.equal((html.match(/Prijs niet vrijgegeven/g) ?? []).length, 5)
    assert.equal(filterHistoricalProducts(historicalRetailerProducts, 'melk', 'DekaMarkt').length, 1)
    assert.equal(filterHistoricalProducts(historicalRetailerProducts, 'bananen', 'PLUS').length, 1)
    for (const item of historicalRetailerProducts) {
      assert.equal(item.price, null)
      assert.equal(item.status, 'historical-source-only')
      assert.equal(new URL(item.sourceUrl).protocol, 'https:')
      assert.ok(Number.isFinite(Date.parse(item.capturedAt)))
      assert.ok(Object.isFrozen(item))
    }
    assert.doesNotMatch(html, /€\s*\d|bespaar tot 40%|officieel prijsbewijs|actuele PLUS prijs/)
  } finally { await vite.close() }
})
