import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts, m3BaselineStore,
  m3CandidateProducts, m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

// This tests what real product TSX renders from entirely fictional M3 fixtures.
// It is not a store observation, authorized ingestion, or public savings proof.
test('rendered M3 comparison names the neutral example store and explicitly denies live savings proof', async () => {
  const forStore = (store, products) => buildOneStoreBasket({
    store, products, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
  })
  const baseline = forStore(m3BaselineStore, m3BaselineProducts)
  const candidate = forStore(m3CandidateStore, m3CandidateProducts)
  const comparison = compareFullBaskets({ baseline, candidate })
  assert.equal(comparison.claimable, true, comparison.reasons.join('; '))
  assert.equal(comparison.outcome, 'better')
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { BasketView } = await vite.ssrLoadModule('/src/features/basket/BasketView.tsx')
    const html = renderToStaticMarkup(createElement(BasketView, {
      basket: baseline,
      comparison,
      comparisonBaseline: baseline,
      comparisonCandidate: candidate,
    }))
    assert.match(html, /Kandidaat · Voorbeeldwinkel B/)
    assert.match(html, /Voorbeeldwinkel B ligt/)
    assert.match(html, /Gecontroleerde winkelvergelijking/)
    assert.match(html, /Geen actuele winkelprijzen of bewezen besparing\./)
    assert.doesNotMatch(html, /M3 testwinkel B|(?:live|echt[e]?)\s+besparingsclaim/i)
    assert.equal(m3CandidateStore.id, 'm3-candidate-store')
    assert.equal(m3CandidateProducts.every(p => p.storeId === m3CandidateStore.id), true)
  } finally {
    await vite.close()
  }
})
