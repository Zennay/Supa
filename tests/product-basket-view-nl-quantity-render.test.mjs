import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts, m3BaselineStore, m3CandidateProducts, m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

// The current App.tsx basket tab uses BasketView; all fixtures are controlled M2/M3.
// This test never produces observed retail savings or changes canonical evidence.
test('product: visible Mand requirement units are Dutch and canonical source data is immutable', async () => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { BasketView } = await vite.ssrLoadModule('/src/features/basket/BasketView.tsx')
    const shared = {
      plan: m2InitialPlan, activeDays: ['Di'], recipes: m2Recipes,
    }
    const baseline = buildOneStoreBasket({
      ...shared, store: m3BaselineStore, products: m3BaselineProducts,
    })
    const candidate = buildOneStoreBasket({
      ...shared, store: m3CandidateStore, products: m3CandidateProducts,
    })
    const comparison = compareFullBaskets({ baseline, candidate })
    const matched = baseline.lines.find(line => line.status === 'matched')
    assert.ok(matched)
    const beforeComparison = structuredClone({ comparison, baseline, candidate })

    const scenarios = [
      { name: 'singular piece', amount: 1, unit: 'piece', expected: 'Benodigd: 1 stuk' },
      { name: 'plural pieces', amount: 4, unit: 'piece', expected: 'Benodigd: 4 stuks' },
      { name: 'grams', amount: 500, unit: 'g', expected: 'Benodigd: 500 g' },
      { name: 'litres', amount: 0.75, unit: 'l', expected: 'Benodigd: 0.75 l' },
      { name: 'unknown', amount: null, unit: 'unknown', expected: 'Benodigd: ? onbekend' },
    ]
    for (const { name, amount, unit, expected } of scenarios) {
      const line = amount === null
        ? {
            id: 'synthetic-unknown', ingredientLabel: 'Onbekende hoeveelheid',
            status: 'unresolved', requirement: { amount, unit },
            reasons: ['synthetic fixture'], matchScore: null,
          }
        : { ...matched, requirement: { amount, unit } }
      const basket = {
        ...baseline, lines: [line],
        matchedLineCount: amount === null ? 0 : 1,
        unresolvedLineCount: amount === null ? 1 : 0,
      }
      const before = structuredClone(basket)
      const html = renderToStaticMarkup(createElement(BasketView, {
        basket, comparison, comparisonBaseline: baseline, comparisonCandidate: candidate,
      }))
      assert.ok(html.includes(expected), `${name}: quantity absent from rendered HTML`)
      assert.doesNotMatch(html, /Benodigd: (?:\\d+(?:\\.\\d+)?|\\?) (?:piece|unknown)/)
      assert.equal(line.requirement.unit, unit, `${name}: canonical quantity must remain intact`)
      assert.deepEqual(basket, before, `${name}: rendering may not mutate basket`)
    }
    assert.deepEqual({ comparison, baseline, candidate }, beforeComparison)
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else delete globalThis.window
    await vite.close()
  }
})
