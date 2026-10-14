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

// Joint QA after composing independent display-only PRs #1849/#1850.
// One canonical synthetic basket drives BOTH views, no fabricated field evidence.
test('qa: Lijst and Mand agree on localized physical demand without implying observed savings', async () => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const [{ ShoppingListView }, { BasketView }] = await Promise.all([
      vite.ssrLoadModule('/src/features/shopping-list/ShoppingListView.tsx'),
      vite.ssrLoadModule('/src/features/basket/BasketView.tsx'),
    ])
    const common = { plan: m2InitialPlan, activeDays: ['Ma'], recipes: m2Recipes }
    const baseline = buildOneStoreBasket({
      ...common, store: m3BaselineStore, products: m3BaselineProducts,
    })
    const candidate = buildOneStoreBasket({
      ...common, store: m3CandidateStore, products: m3CandidateProducts,
    })
    const renderList = basket => renderToStaticMarkup(
      createElement(ShoppingListView, { basket }),
    )
    const renderBasket = (basket, comparison) => renderToStaticMarkup(
      createElement(BasketView, {
        basket, comparison, comparisonBaseline: basket, comparisonCandidate: candidate,
      }),
    )
    const before = structuredClone({ baseline, candidate })
    const piece = baseline.lines.find(line =>
      line.status === 'matched' &&
      line.requirement.unit === 'piece' &&
      line.pack.unit === 'piece',
    )
    assert.ok(piece, 'the synthetic Ma plan has a concrete piece item')
    const comparison = compareFullBaskets({ baseline, candidate })
    const list = renderList(baseline)
    const mand = renderBasket(baseline, comparison)
    assert.match(list, /1 × 1 stuk/)
    assert.match(mand, /Benodigd: 1 stuk/)
    assert.doesNotMatch(list + mand, /\bpiece\b|\bunknown\b/)
    assert.match(mand, /testdata|testfixture/)
    assert.deepEqual({ baseline, candidate }, before)

    // One unresolved physical requirement must remain explicitly unresolved
    // across both screens and the comparator, rather than becoming "saved".
    const unknownLine = {
      id: piece.id,
      ingredientLabel: piece.ingredientLabel,
      status: 'unresolved',
      requirement: { amount: null, unit: 'unknown' },
      reasons: ['synthetic fixture only'],
      matchScore: null,
    }
    const uncertain = {
      ...baseline,
      lines: baseline.lines.map(line => line.id === piece.id ? unknownLine : line),
      totalCents: baseline.totalCents - piece.lineTotalCents,
      matchedLineCount: baseline.matchedLineCount - 1,
      unresolvedLineCount: baseline.unresolvedLineCount + 1,
    }
    const uncertainty = compareFullBaskets({ baseline: uncertain, candidate })
    assert.equal(uncertainty.claimable, false)
    assert.equal(uncertainty.savingsCents, null)
    const uncertainBefore = structuredClone(uncertain)
    const uncertainList = renderList(uncertain)
    const uncertainMand = renderBasket(uncertain, uncertainty)
    assert.match(uncertainList, /\? onbekend · handmatig kiezen/)
    assert.match(uncertainMand, /Benodigd: \? onbekend/)
    assert.match(uncertainMand, /Geen financieel verschil tonen/)
    assert.doesNotMatch(uncertainList + uncertainMand, /(?:Benodigd: | × |\? )(?:piece|unknown)\b/)
    assert.deepEqual(uncertain, uncertainBefore)
    assert.deepEqual({ baseline, candidate }, before)
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
    await vite.close()
  }
})
