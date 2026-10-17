import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

// Independent QA: exercise the actual Figma-based App tree via Vite SSR,
// not a source-text imitation or reimplementation of the shopping domain.
// No browser fetch, retailer HTTP, permissions or storage writes occur.
test('original Figma Home retains five destinations while real planner/basket remain isolated from demo content', async (t) => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    logLevel: 'error',
  })
  try {
    const { App } = await vite.ssrLoadModule('/src/App.tsx')
    const { HiFiDemoList } = await vite.ssrLoadModule('/src/features/home/HiFiHome.tsx')
    const renderApp = (initialTab) => renderToStaticMarkup(
      createElement(App, initialTab ? { initialTab } : {}),
    )

    await t.test('default route is Figma 3307:4224, with all five canonical labelled destinations', () => {
      const markup = renderApp()
      assert.match(markup, /data-figma-node="3307:4224"/)
      assert.match(markup, /<h1[^>]*>Weekplanning<\/h1>/)
      assert.match(markup, /Plan en bespaar/)
      assert.match(markup, /aria-label="Hoofdnavigatie"/)
      for (const label of ['Home', 'Planner', 'Recepten', 'Producten', 'Lijst']) {
        assert.match(markup, new RegExp('aria-label="' + label + '"'), label)
      }
      assert.equal((markup.match(/aria-current="page"/g) ?? []).length, 1)
      assert.match(markup, /prijzen en aanbiedingen zijn niet actueel/)
      assert.doesNotMatch(markup, /40%/)
    })

    await t.test('dedicated Recipes and Products routes preserve Figma discovery separation', () => {
      const recipes = renderApp('recipes')
      const products = renderApp('products')
      assert.match(recipes, /<h1[^>]*>Recepten<\/h1>/)
      assert.match(recipes, /class="hifi-recipe-card"/)
      assert.doesNotMatch(recipes, /class="hifi-product-card"/)
      assert.match(products, /<h1[^>]*>Producten<\/h1>/)
      assert.match(products, /class="hifi-product-card"/)
      assert.doesNotMatch(products, /class="hifi-recipe-card"/)
      assert.equal((recipes.match(/aria-current="page"/g) ?? []).length, 1)
      assert.equal((products.match(/aria-current="page"/g) ?? []).length, 1)
    })

    await t.test('the real planner and comparison still render without mocked Figma product prices', () => {
      const planner = renderApp('planner')
      const basket = renderApp('basket')
      assert.match(planner, /Weekmenu delen/)
      assert.match(planner, /aria-label="Hoofdnavigatie"/)
      assert.match(basket, /Geen actuele winkelprijzen of bewezen besparing/)
      assert.doesNotMatch(basket, /Del Monte Bananen/)
      assert.doesNotMatch(basket, /Coca cola zero 1\.5l fl/)
      assert.doesNotMatch(basket, /class="hifi-product-grid"/)
      assert.doesNotMatch(planner, /class="hifi-product-grid"/)
    })

    await t.test('design selections stay an explicitly unpriced, separately removable demo list', () => {
      const list = renderToStaticMarkup(createElement(HiFiDemoList, {
        ids: ['bananas', 'cola-zero', 'not-a-design-product'],
        onRemove: () => {},
      }))
      assert.match(list, /Demolijst/)
      assert.match(list, /Niet meegenomen in de mandvergelijking/)
      assert.match(list, /Del Monte Bananen/)
      assert.match(list, /Coca cola zero 1\.5l fl/)
      assert.equal((list.match(/aria-label="Verwijder:/g) ?? []).length, 2)
      assert.doesNotMatch(list, /not-a-design-product/)
    })
  } finally {
    await vite.close()
  }
})
