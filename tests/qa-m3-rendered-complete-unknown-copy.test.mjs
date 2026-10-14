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

const makeBasket = (store, products, activeDays = m2DefaultActiveDays) =>
  buildOneStoreBasket({ store, products, plan: m2InitialPlan, recipes: m2Recipes, activeDays })

function assertUserFacingEvidenceCopy(html, expectedState) {
  assert.match(html, new RegExp(`data-basket-total-state="${expectedState}"`))
  assert.match(html, /voorbeeldprijzen|voorbeeldmandje/i)
  assert.match(html, /geen actuele winkelprijzen of bewezen besparing/i)
  assert.doesNotMatch(html, /M2 testfixture|M3 controlled testdata|interne milestone/i)
  assert.doesNotMatch(html, /gegarandeerd bespaard|echte winkelkorting/i)
}

test('QA M3: actual rendered Mand copy stays truthful for full, unresolved and empty controlled baskets', async () => {
  const baseline = makeBasket(m3BaselineStore, m3BaselineProducts)
  const completeCandidate = makeBasket(m3CandidateStore, m3CandidateProducts)
  const full = compareFullBaskets({ baseline, candidate: completeCandidate })
  assert.equal(full.claimable, true)
  assert.equal(baseline.unresolvedLineCount, 0)
  assert.equal(completeCandidate.unresolvedLineCount, 0)

  const incompleteCandidate = makeBasket(m3CandidateStore, [])
  const partial = compareFullBaskets({ baseline, candidate: incompleteCandidate })
  assert.ok(incompleteCandidate.unresolvedLineCount > 0)
  assert.equal(partial.claimable, false)
  assert.equal(partial.outcome, 'unknown')

  const emptyBaseline = makeBasket(m3BaselineStore, m3BaselineProducts, [])
  const emptyCandidate = makeBasket(m3CandidateStore, m3CandidateProducts, [])
  assert.equal(emptyBaseline.selectedMealCount, 0)
  assert.equal(emptyCandidate.selectedMealCount, 0)
  assert.equal(emptyBaseline.lines.length, 0)
  const emptyComparison = compareFullBaskets({
    baseline: emptyBaseline, candidate: emptyCandidate,
  })

  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { BasketView } = await vite.ssrLoadModule('/src/features/basket/BasketView.tsx')
    const render = (basket, comparison, comparisonBaseline, comparisonCandidate) =>
      renderToStaticMarkup(createElement(BasketView, {
        basket, comparison, comparisonBaseline, comparisonCandidate,
      }))

    const completeHtml = render(baseline, full, baseline, completeCandidate)
    assertUserFacingEvidenceCopy(completeHtml, 'complete')
    assert.match(completeHtml, /Vergelijking van voorbeeldprijzen voor dezelfde week/)
    assert.match(completeHtml, /data-comparison-line-breakdown="true"/)
    assert.match(completeHtml, /waar deze voorbeeldmanden verschillen, niet[\s\S]*waarom/)
    assert.doesNotMatch(completeHtml, /Geen financieel verschil tonen/)

    const partialHtml = render(incompleteCandidate, partial, baseline, incompleteCandidate)
    assertUserFacingEvidenceCopy(partialHtml, 'minimum')
    assert.match(partialHtml, /nog niet meegerekend/)
    assert.match(partialHtml, /Geen financieel verschil tonen/)
    assert.doesNotMatch(partialHtml, /data-comparison-line-breakdown/)
    assert.doesNotMatch(partialHtml, /ligt[^<]*lager|ligt[^<]*hoger/)

    const emptyHtml = render(emptyBaseline, emptyComparison, emptyBaseline, emptyCandidate)
    assert.match(emptyHtml, /data-comparison-outcome="unknown"/)
    assert.match(emptyHtml, /Plan eerst maaltijden om winkels te vergelijken/)
    assert.match(emptyHtml, /zonder boodschappen is er geen financieel verschil/)
    assert.doesNotMatch(emptyHtml, /data-comparison-line-breakdown/)
    assert.doesNotMatch(emptyHtml, /ligt[^<]*lager|ligt[^<]*hoger/)
  } finally {
    await vite.close()
  }
})
