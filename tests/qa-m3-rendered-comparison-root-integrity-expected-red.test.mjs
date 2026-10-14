import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts, m3BaselineStore, m3CandidateProducts, m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

// Expected RED against the isolated product source. Everything here is
// fictional and local. This is not a live retailer observation or an
// assertion that a genuine observed weekly basket has savings evidence.
test('QA M3 expected RED: forged claimable basket totals must not display a confident comparison title', async () => {
  const basket = (store, products) => buildOneStoreBasket({
    store, products, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
  })
  const baseline = basket(m3BaselineStore, m3BaselineProducts)
  const candidate = basket(m3CandidateStore, m3CandidateProducts)
  const actual = compareFullBaskets({ baseline, candidate })
  assert.equal(actual.claimable, true, 'Synthetic positive control must be comparable')
  assert.ok(baseline.lines.length > 0 && candidate.lines.length > 0)

  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { BasketView } = await vite.ssrLoadModule('/src/features/basket/BasketView.tsx')
    const render = comparison => renderToStaticMarkup(createElement(BasketView, {
      basket: baseline,
      comparison,
      comparisonBaseline: baseline,
      comparisonCandidate: candidate,
    }))

    const control = render(actual)
    assert.match(control, /data-comparison-outcome="(better|same|worse)"/)

    const forged = [
      { ...actual, claimable: true, outcome: 'better', savingsCents: NaN },
      { ...actual, claimable: true, outcome: 'better', savingsCents: null },
      { ...actual, claimable: true, outcome: 'worse', deltaCents: NaN },
      { ...actual, claimable: true, outcome: 'better', deltaCents: actual.deltaCents + 1 },
      { ...actual, claimable: true, outcome: 'worse', savingsCents: 0 },
      { ...actual, claimable: true, outcome: 'better', lineDeltas: [] },
    ]
    for (const [index, comparison] of forged.entries()) {
      const html = render(comparison)
      assert.match(html, /data-comparison-outcome="unknown"/,
        `untrusted comparison ${index} must not be labeled better or worse`)
      assert.match(html, /Geen financieel verschil tonen|Nog geen betrouwbare vergelijking/,
        `untrusted comparison ${index} requires an explicit warning`)
      assert.doesNotMatch(html, /data-comparison-line-breakdown/,
        `untrusted comparison ${index} cannot show pseudo-authoritative financial lines`)
    }
  } finally {
    await vite.close()
  }
})
