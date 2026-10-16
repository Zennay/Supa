import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('actual Figma Producten route keeps sample prices visibly separate from real basket claims', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { HiFiHome } = await vite.ssrLoadModule('/src/features/home/HiFiHome.tsx')
    const html = renderToStaticMarkup(createElement(HiFiHome, {
      view: 'products', addedProducts: [], activeDays: [],
      onNavigate() { assert.fail('SSR should not navigate') },
      onToggleProduct() { assert.fail('SSR should not mutate') },
    }))
    assert.match(html, /data-figma-node="3064:3125"/)
    assert.match(html, /<h1 class="hifi-page-title">Producten<\/h1>/)
    assert.match(html, /Zoek producten/)
    assert.match(html, /Laagste prijs per kg \/ l/)
    assert.match(html, /aria-label="Sorteer voorbeeldproducten op laagste prijs per kg of liter"/)
    assert.match(html, /Ontwerpvoorbeelden · prijzen en aanbiedingen zijn niet actueel/)
    assert.match(html, /4 producten/)
    assert.equal((html.match(/class="hifi-product-card"/g) ?? []).length, 4)
    assert.doesNotMatch(html, /bespaar tot 40%|officieel prijsbewijs|actuele PLUS prijs/)
  } finally { await vite.close() }
})
