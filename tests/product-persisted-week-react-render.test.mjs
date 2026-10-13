import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { serializePlannerPreferences } from '../src/domain/plannerPreferences.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts,
  m3BaselineStore,
  m3CandidateProducts,
  m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

const mockBudgetAndWeek = {
  budget: 40,
  activeDays: ['Di', 'Do'],
  recipeByDay: { Ma: 'tikka', Di: 'pasta', Wo: 'pasta', Do: 'teriyaki' },
}

function basketsFor(preferences) {
  const plan = m2InitialPlan.map((meal) => ({
    ...meal,
    recipeId: preferences.recipeByDay[meal.day],
  }))
  const common = { plan, activeDays: preferences.activeDays, recipes: m2Recipes }
  const shopping = buildOneStoreBasket({ ...common, store: m2Store, products: m2Products })
  const baseline = buildOneStoreBasket({
    ...common, store: m3BaselineStore, products: m3BaselineProducts,
  })
  const candidate = buildOneStoreBasket({
    ...common, store: m3CandidateStore, products: m3CandidateProducts,
  })
  return { shopping, baseline, candidate, comparison: compareFullBaskets({ baseline, candidate }) }
}

function withBrowserStorage(raw, fn) {
  const previous = globalThis.window
  globalThis.window = { localStorage: { getItem: () => raw } }
  try {
    return fn()
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
}

test('real App/Planner, Basket and ShoppingList React screens agree after persisted recipe edits', async (t) => {
  const vite = await createServer({
    configFile: false,
    root: new URL('../', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })
  t.after(async () => { await vite.close() })

  const [{ App }, { BasketView }, { ShoppingListView }] = await Promise.all([
    vite.ssrLoadModule('/src/App.tsx'),
    vite.ssrLoadModule('/src/features/basket/BasketView.tsx'),
    vite.ssrLoadModule('/src/features/shopping-list/ShoppingListView.tsx'),
  ])

  const planHtml = withBrowserStorage(
    serializePlannerPreferences(mockBudgetAndWeek),
    () => renderToStaticMarkup(createElement(App)),
  )
  assert.match(planHtml, /Plan eerst\. Vergelijk daarna\./)
  assert.match(planHtml, /2 maaltijden actief/)
  assert.match(planHtml, /€\s*40,00/)
  assert.match(planHtml, /id="recipe-Di"/)
  assert.match(planHtml, /Romige tomatenpasta/)
  assert.match(planHtml, /Teriyaki-bowl met groenten/)

  const { shopping, baseline, candidate, comparison } = basketsFor(mockBudgetAndWeek)
  const basketHtml = renderToStaticMarkup(createElement(BasketView, {
    basket: shopping,
    comparison,
    comparisonBaseline: baseline,
    comparisonCandidate: candidate,
  }))
  const listHtml = withBrowserStorage(null, () =>
    renderToStaticMarkup(createElement(ShoppingListView, { basket: shopping })),
  )
  assert.match(basketHtml, /Gecontroleerde winkelvergelijking/)
  assert.match(basketHtml, /geen live-besparingsclaim/)
  assert.match(listHtml, /Boodschappenlijst/)
  for (const line of shopping.lines) {
    assert.ok(basketHtml.includes(line.ingredientLabel), `basket missing ${line.id}`)
    const label = line.status === 'matched' ? line.productName : line.ingredientLabel
    assert.ok(listHtml.includes(label), `shopping list missing ${line.id}`)
  }
  assert.equal(baseline.selectedMealCount, 2)
  assert.equal(candidate.selectedMealCount, 2)
  assert.equal(comparison.claimable, true)
})

test('real App restored empty week renders no phantom meals or budgeted savings', async (t) => {
  const vite = await createServer({
    configFile: false,
    root: new URL('../', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })
  t.after(async () => { await vite.close() })

  const { App } = await vite.ssrLoadModule('/src/App.tsx')
  const empty = { ...mockBudgetAndWeek, activeDays: [] }
  const html = withBrowserStorage(
    serializePlannerPreferences(empty),
    () => renderToStaticMarkup(createElement(App)),
  )
  assert.match(html, /0 maaltijden actief/)
  assert.doesNotMatch(html, /2 maaltijden actief/)
  const { shopping, baseline, candidate, comparison } = basketsFor(empty)
  for (const basket of [shopping, baseline, candidate]) {
    assert.equal(basket.totalCents, 0)
    assert.equal(basket.lines.length, 0)
  }
  assert.equal(comparison.outcome, 'same')
  assert.equal(comparison.savingsCents, 0)
})
