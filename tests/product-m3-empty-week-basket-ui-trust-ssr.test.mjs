import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'

test('routed M3 Mand refuses optimistic same-price claim when no groceries are planned', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { BasketView } = await vite.ssrLoadModule('/src/features/basket/BasketView.tsx')
    const build = days => buildOneStoreBasket({
      store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
      products: m2Products, activeDays: days,
    })
    const empty = build([])
    const matched = build(['Di'])
    assert.equal(empty.lines.length, 0)
    assert.ok(matched.lines.length > 0)

    // Deliberately supply the still-pending domain owner's wrong/optimistic
    // comparison contract to prove that UI never publishes the empty claim.
    const optimistic = {
      outcome: 'same', claimable: true, savingsCents: 0, deltaCents: 0,
      lineDeltas: [], reasons: [],
    }
    const render = (basket, baseline, candidate) => renderToStaticMarkup(
      createElement(BasketView, {
        basket, comparison: optimistic,
        comparisonBaseline: { ...baseline, store: { id: 'fictional-plus', name: 'PLUS fictief' } },
        comparisonCandidate: { ...candidate, store: { id: 'fictional-deka', name: 'DekaMarkt fictief' } },
      }),
    )
    const before = structuredClone(empty)
    for (const [base, candidate] of [[empty, empty], [empty, matched], [matched, empty]]) {
      const html = render(empty, base, candidate)
      assert.match(html, /data-comparison-outcome="unknown"/)
      assert.match(html, /Plan eerst maaltijden om winkels te vergelijken/)
      assert.match(html, /geen financieel verschil te vergelijken/)
      assert.doesNotMatch(html, /Beide testmanden zijn even duur/)
      assert.doesNotMatch(html, /M3 controlled testdata/)
    }
    assert.deepEqual(empty, before)

    // Guard is not a global disabling of valid, nonempty same-price baskets.
    const complete = render(matched, matched, matched)
    assert.match(complete, /data-comparison-outcome="same"/)
    assert.match(complete, /Beide testmanden zijn even duur/)
    assert.match(complete, /M3 controlled testdata/)
    assert.doesNotMatch(complete, /Plan eerst maaltijden om winkels te vergelijken/)
  } finally {
    await vite.close()
  }
})
