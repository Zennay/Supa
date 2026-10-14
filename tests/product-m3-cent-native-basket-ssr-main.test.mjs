import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { euro } from '../src/lib/money.ts'
import { basketCostDisclosure, basketComparisonHeadline, basketComparisonCanShowMoney } from '../src/features/basket/basketPresentation.ts'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Recipes, m2Products, m2Store } from '../src/data/m2Fixture.ts'

const largeCents = 9_007_199_253_740_993 // finite positive safe integer, one-cent float roundtrip is unsafe

test('M3 complete and incomplete totals preserve every cent on integer-only display', () => {
  const exact = euro.formatCents(largeCents)
  assert.notEqual(exact, euro.format(largeCents / 100), 'old float path loses cent precision')
  assert.match(exact, /,93$/)
  assert.equal(basketCostDisclosure(largeCents, 0).amountLabel, exact)
  assert.equal(basketCostDisclosure(largeCents, 2).amountLabel, 'min. ' + exact)
  assert.equal(basketCostDisclosure(0, 0).amountLabel, euro.formatCents(0))
  for (const bad of [NaN, Infinity, -Infinity, 5.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(basketCostDisclosure(bad, 0).amountLabel, '—')
  }
})

test('M3 candidate headline never invents a zero-difference when money is unverified', () => {
  const candidate = { store: { id: 'fictional-b', name: 'Voorbeeldwinkel B' } }
  const trusted = {
    claimable: true, outcome: 'worse', baselineTotalCents: 0, candidateTotalCents: largeCents,
    deltaCents: largeCents, savingsCents: -largeCents, lineDeltas: [], reasons: [],
  }
  assert.equal(basketComparisonCanShowMoney(trusted, candidate), true)
  assert.equal(basketComparisonHeadline(trusted, candidate),
    'Voorbeeldwinkel B ligt ' + euro.formatCents(largeCents) + ' hoger')
  for (const bad of [
    { savingsCents: null }, { savingsCents: '100' }, { savingsCents: -1 },
    { deltaCents: 1 }, { candidateTotalCents: largeCents - 1 },
    { claimable: false }, { reasons: ['not comparable'] },
  ]) {
    assert.equal(basketComparisonCanShowMoney({ ...trusted, ...bad }, candidate), false)
    assert.equal(basketComparisonHeadline({ ...trusted, ...bad }, candidate),
      'Nog geen betrouwbare vergelijking')
  }
})

test('live BasketView shows cent-exact full basket and individual line for large synthetic integer totals', async () => {
  const base = buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, activeDays: ['Di'],
    recipes: m2Recipes, products: m2Products,
  })
  const example = {
    ...base,
    totalCents: largeCents,
    unresolvedLineCount: 0,
    matchedLineCount: 1,
    lines: [{ ...base.lines.find(line => line.status === 'matched'),
      id: 'large-synthetic', ingredientLabel: 'Fictieve prijsregel',
      status: 'matched', lineTotalCents: largeCents }],
  }
  const unclaimable = {
    claimable: false, outcome: 'unknown', baselineTotalCents: 0, candidateTotalCents: 0,
    deltaCents: null, savingsCents: null, lineDeltas: [],
    reasons: ['synthetic amount, no retailer evidence'],
  }
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  try {
    const { BasketView } = await vite.ssrLoadModule('/src/features/basket/BasketView.tsx')
    const html = renderToStaticMarkup(createElement(BasketView, {
      basket: example, comparison: unclaimable,
      comparisonBaseline: { ...example, store: { id: 'fictional-a', name: 'Voorbeeld A' } },
      comparisonCandidate: { ...example, store: { id: 'fictional-b', name: 'Voorbeeld B' } },
    }))
    const amount = euro.formatCents(largeCents)
    assert.ok(html.includes(amount))
    assert.equal(html.split(amount).length - 1, 4, 'whole basket, both store totals and exact matched row')
    assert.match(html, /Fictieve prijsregel/)
    assert.match(html, /Geen financieel verschil tonen/)
    assert.doesNotMatch(html, /data-comparison-line-breakdown/)
  } finally { await vite.close() }
})
