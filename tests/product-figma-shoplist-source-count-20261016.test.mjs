import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Recipes, m2Products, m2Store } from '../src/data/m2Fixture.ts'

test('Shoplist Figma header uses actual basket store and count; no prototype retailer or prices', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { ShoppingListView } = await vite.ssrLoadModule('/src/features/shopping-list/ShoppingListView.tsx')
    const basket = buildOneStoreBasket({
      store: m2Store, plan: m2InitialPlan, activeDays: ['Ma'],
      recipes: m2Recipes, products: m2Products,
    })
    const input = structuredClone(basket)
    assert.ok(basket.lines.length)
    const html = renderToStaticMarkup(createElement(ShoppingListView, { basket }))
    assert.match(html, /data-figma-node="3342:4815"/)
    assert.match(html, /data-figma-node="4168:17199"/)
    assert.match(html, /data-figma-node="3342:4838"/)
    assert.ok(html.includes(m2Store.name))
    assert.match(html, /Voorbeeldmand · geen actuele winkelprijzen/)
    assert.match(html, new RegExp(`>${basket.lines.length} items<`))
    assert.equal((html.match(/class="shopping-row"/g) ?? []).length, basket.lines.filter(line => line.status === 'matched').length)
    assert.equal((html.match(/class="shopping-row(?: checked)? unresolved-shopping"/g) ?? []).length, basket.lines.filter(line => line.status === 'unresolved').length)
    assert.doesNotMatch(html, /€|bespaar tot 40%|actuele PLUS prijs|actuele DekaMarkt prijs/)
    assert.deepEqual(basket, input)
  } finally {
    await vite.close()
  }
})
