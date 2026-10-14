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
import {
  hasTrustedComparisonLineEvidence,
  comparisonMatchesVisibleBaskets,
} from '../src/features/basket/comparisonLineHighlights.ts'

const build = (store, products) => buildOneStoreBasket({
  store, products, plan: m2InitialPlan, recipes: m2Recipes,
  activeDays: m2DefaultActiveDays,
})

test('M3 financial title requires the same physical ledger as both displayed example baskets', async () => {
  const baseline = build(m3BaselineStore, m3BaselineProducts)
  const candidate = build(m3CandidateStore, m3CandidateProducts)
  const comparison = compareFullBaskets({ baseline, candidate })
  assert.equal(comparison.claimable, true)
  assert.ok(comparison.lineDeltas.length > 0)
  assert.equal(hasTrustedComparisonLineEvidence(comparison), true)
  assert.equal(comparisonMatchesVisibleBaskets(comparison, baseline, candidate), true)

  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { BasketView } = await vite.ssrLoadModule('/src/features/basket/BasketView.tsx')
    const render = (value, a = baseline, b = candidate) => renderToStaticMarkup(
      createElement(BasketView, {
        basket: a, comparison: value, comparisonBaseline: a, comparisonCandidate: b,
      }),
    )
    const positive = render(comparison)
    assert.match(positive, /data-comparison-outcome="(better|worse|same)"/)

    const changes = [
      [{ ...comparison, lineDeltas: [] }, baseline, candidate],
      [{ ...comparison, lineDeltas: null }, baseline, candidate],
      [{ ...comparison, savingsCents: NaN }, baseline, candidate],
      [{ ...comparison, outcome: comparison.outcome === 'better' ? 'worse' : 'better' }, baseline, candidate],
      [{ ...comparison, baselineTotalCents: comparison.baselineTotalCents + 1 }, baseline, candidate],
      [{ ...comparison, lineDeltas: comparison.lineDeltas.map((line, index) =>
        index === 0 ? { ...line, candidateLineTotalCents: line.candidateLineTotalCents + 1 } : line),
      }, baseline, candidate],
      [comparison, { ...baseline, totalCents: baseline.totalCents + 1 }, candidate],
      [comparison, baseline, { ...candidate, totalCents: candidate.totalCents + 1 }],
      [comparison, baseline, { ...candidate, lines: candidate.lines.slice(1),
        matchedLineCount: candidate.matchedLineCount - 1 }],
      [comparison, baseline, { ...candidate,
        lines: candidate.lines.map((line, index) => index === 0 && line.status === 'matched'
          ? { ...line, lineTotalCents: line.lineTotalCents + 1 } : line) }],
    ]

    for (const [index, [value, a, b]] of changes.entries()) {
      assert.equal(comparisonMatchesVisibleBaskets(value, a, b), false, String(index))
      const html = render(value, a, b)
      assert.match(html, /data-comparison-outcome="unknown"/, String(index))
      assert.match(html, /Geen financieel verschil tonen/, String(index))
      assert.doesNotMatch(html, /data-comparison-line-breakdown/, String(index))
      assert.doesNotMatch(html, /ligt .+ (lager|hoger)/, String(index))
    }
    // Synthetic same-price scenario with all physical rows present remains valid.
    const same = { ...comparison, outcome: 'same',
      candidateTotalCents: comparison.baselineTotalCents, deltaCents: 0, savingsCents: 0,
      lineDeltas: comparison.lineDeltas.map(line => ({
        ...line, candidateLineTotalCents: line.baselineLineTotalCents, deltaCents: 0,
      })),
    }
    assert.equal(comparisonMatchesVisibleBaskets(same, baseline, { ...baseline,
      store: candidate.store }), true)
    const sameHtml = render(same, baseline, { ...baseline, store: candidate.store })
    assert.match(sameHtml, /data-comparison-outcome="same"/)
    assert.match(sameHtml, /Beide testmanden zijn even duur/)
  } finally {
    await vite.close()
  }
})
