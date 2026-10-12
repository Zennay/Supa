import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  m3BaselineStore, m3BaselineProducts, m3CandidateStore, m3CandidateProducts,
} from '../src/data/m3ComparisonFixture.ts'

// Independent post-repair QA on #1850: localizing only the unit cannot turn
// unresolved basket costs into a savings claim. Synthetic products only.
test('qa: localized unknown quantity keeps M3 comparison money fail-closed in real BasketView SSR', async () => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { BasketView } = await vite.ssrLoadModule('/src/features/basket/BasketView.tsx')
    const common = { plan: m2InitialPlan, activeDays: ['Ma'], recipes: m2Recipes }
    const completeBaseline = buildOneStoreBasket({
      ...common, store: m3BaselineStore, products: m3BaselineProducts,
    })
    const candidate = buildOneStoreBasket({
      ...common, store: m3CandidateStore, products: m3CandidateProducts,
    })
    const matched = completeBaseline.lines.find(line => line.status === 'matched')
    assert.ok(matched, 'synthetic basket must have a matched line')
    const unresolved = {
      id: matched.id,
      ingredientLabel: matched.ingredientLabel,
      status: 'unresolved',
      requirement: { amount: null, unit: 'unknown' },
      reasons: ['synthetic uncertainty, not a real retailer observation'],
      matchScore: null,
    }
    const baseline = {
      ...completeBaseline,
      lines: completeBaseline.lines.map(line => line.id === matched.id ? unresolved : line),
      totalCents: completeBaseline.totalCents - matched.lineTotalCents,
      matchedLineCount: completeBaseline.matchedLineCount - 1,
      unresolvedLineCount: completeBaseline.unresolvedLineCount + 1,
    }
    assert.ok(baseline.totalCents >= 0)
    const comparison = compareFullBaskets({ baseline, candidate })
    assert.equal(comparison.claimable, false)
    assert.equal(comparison.outcome, 'unknown')
    assert.equal(comparison.deltaCents, null)
    assert.equal(comparison.savingsCents, null)
    const before = structuredClone({ baseline, candidate, comparison })
    const html = renderToStaticMarkup(createElement(BasketView, {
      basket: baseline, comparison, comparisonBaseline: baseline, comparisonCandidate: candidate,
    }))
    assert.match(html, /Benodigd: \? onbekend/)
    assert.match(html, /Bekend mandminimum/)
    assert.match(html, /Geen financieel verschil tonen/)
    assert.match(html, /geen productie-liveprijs|geen.*live-besparingsclaim|Geen financieel verschil tonen/)
    assert.doesNotMatch(html, /Benodigd: \? unknown|Benodigd: \? piece/)
    assert.doesNotMatch(html, /ligt .* (?:hoger|lager)|Beide testmanden zijn even duur/)
    assert.deepEqual({ baseline, candidate, comparison }, before)
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else delete globalThis.window
    await vite.close()
  }
})
