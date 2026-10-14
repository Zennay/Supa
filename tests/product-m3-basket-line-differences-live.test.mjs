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
import { comparisonLineHighlights } from '../src/features/basket/comparisonLineHighlights.ts'

function complete() {
  const basket = (store, products) => buildOneStoreBasket({
    store, products, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
  })
  const baseline = basket(m3BaselineStore, m3BaselineProducts)
  const candidate = basket(m3CandidateStore, m3CandidateProducts)
  return { baseline, candidate, comparison: compareFullBaskets({ baseline, candidate }) }
}

test('M3 visible line proof orders exact differences without causal or retailer claims', () => {
  const { comparison } = complete()
  assert.equal(comparison.claimable, true)
  const rows = comparisonLineHighlights(comparison)
  assert.ok(rows.length > 0 && rows.length <= 3)
  assert.ok(rows.every(row => row.direction === 'higher' || row.direction === 'lower'))
  assert.deepEqual(rows, comparisonLineHighlights(comparison))
  const unknown = { ...comparison, claimable: false, outcome: 'unknown' }
  assert.deepEqual(comparisonLineHighlights(unknown), [])
  assert.deepEqual(comparisonLineHighlights({ ...comparison, lineDeltas: [] }), [])
  assert.deepEqual(comparisonLineHighlights({ ...comparison, savingsCents: null }), [])
  assert.deepEqual(comparisonLineHighlights({ ...comparison,
    lineDeltas: [{ ...comparison.lineDeltas[0], deltaCents: Number.NaN }],
  }), [])
  assert.deepEqual(comparisonLineHighlights({ ...comparison,
    lineDeltas: [...comparison.lineDeltas, comparison.lineDeltas[0]],
  }), [])
  assert.deepEqual(comparisonLineHighlights({ ...comparison,
    lineDeltas: comparison.lineDeltas.map((line, index) =>
      index === 0 ? { ...line, ingredientLabel: 'Rijst\u202emalicious' } : line),
  }), [])
})

test('actual routed M3 Mand shows line breakdown only for comparable nonempty baskets', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { BasketView } = await vite.ssrLoadModule('/src/features/basket/BasketView.tsx')
    const { baseline, candidate, comparison } = complete()
    const render = (basket, compare, base, cand) => renderToStaticMarkup(
      createElement(BasketView, {
        basket, comparison: compare, comparisonBaseline: base, comparisonCandidate: cand,
      }),
    )
    const html = render(baseline, comparison, baseline, candidate)
    assert.match(html, /data-comparison-line-breakdown="true"/)
    assert.match(html, /Grootste verschillen per ingrediënt/)
    assert.match(html, /niet[\s\S]*waarom/)
    assert.match(html, /geen aanbiedingen, besparingen of live prijzen/i)
    const unknown = render(baseline,
      { ...comparison, outcome: 'unknown', claimable: false, reasons: ['incomplete'] },
      baseline, candidate)
    assert.doesNotMatch(unknown, /data-comparison-line-breakdown/)
    const empty = { ...baseline, lines: [], selectedMealCount: 0 }
    assert.doesNotMatch(render(empty, comparison, empty, candidate), /data-comparison-line-breakdown/)
  } finally {
    await vite.close()
  }
})
