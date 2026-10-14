import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { comparisonMatchesVisibleBaskets } from '../src/features/basket/comparisonLineHighlights.ts'

// All items/prices are invented acceptance fixtures, NEVER retailer evidence.
const recipes = [{
  id: 'fictional-rice',
  title: 'Fictief gerecht',
  minutes: 15,
  servings: 1,
  estimatedCost: 0,
  tags: [],
  ingredients: [{ id: 'rice', label: 'Basmati rijst', query: 'basmati rijst', amount: 100, unit: 'g' }],
}]
const plan = [{ day: 'Ma', recipeId: 'fictional-rice' }]
function storeBasket(storeId, cents) {
  return buildOneStoreBasket({
    store: { id: storeId, name: storeId === 'example-a' ? 'Voorbeeldwinkel A' : 'Voorbeeldwinkel B' },
    plan, recipes, activeDays: ['Ma'],
    products: [{
      id: storeId + '-rice', storeId,
      name: 'Basmati rijst', packAmount: 100, packUnit: 'g',
      available: true, priceCents: cents,
    }],
  })
}
function pair(candidateCents = 190) {
  const baseline = storeBasket('example-a', 200)
  const candidate = storeBasket('example-b', candidateCents)
  const comparison = compareFullBaskets({ baseline, candidate })
  assert.equal(comparison.claimable, true)
  assert.equal(comparison.lineDeltas.length, 1)
  assert.equal(baseline.lines[0].status, 'matched')
  assert.equal(candidate.lines[0].status, 'matched')
  return { baseline, candidate, comparison }
}

for (const [label, cents] of [['better', 190], ['same', 200], ['worse', 210]]) {
  test(`genuine consistent synthetic ${label} line remains financially explainable`, () => {
    const { baseline, candidate, comparison } = pair(cents)
    assert.equal(comparison.outcome, label)
    assert.equal(comparisonMatchesVisibleBaskets(comparison, baseline, candidate), true)
  })
}

const mutants = [
  ['understated needed baseline quantity', 'baseline', line => {
    line.requirement = { ...line.requirement, amount: 200 }
  }],
  ['understated needed candidate quantity', 'candidate', line => {
    line.requirement = { ...line.requirement, amount: 200 }
  }],
  ['false baseline pack quantity', 'baseline', line => {
    line.pack = { ...line.pack, amount: 10 }
  }],
  ['false candidate pack quantity', 'candidate', line => {
    line.pack = { ...line.pack, amount: 10 }
  }],
  ['invalid candidate pack family', 'candidate', line => {
    line.pack = { ...line.pack, unit: 'l' }
  }],
  ['implausible candidate pack count', 'candidate', line => {
    line.packs = 2
  }],
  ['untrusted baseline matching confidence', 'baseline', line => {
    line.matchScore = 0
  }],
  ['untrusted candidate matching confidence', 'candidate', line => {
    line.matchScore = 0
  }],
  ['price metadata no longer agrees with physical cents', 'candidate', line => {
    line.pricePerPackCents += 1
  }],
]
for (const [label, side, mutate] of mutants) {
  test(`visible M3 finance rejects ${label} even when line displayed cents match`, () => {
    const data = pair()
    const originalMoney = data[side].lines[0].lineTotalCents
    const originalRoot = data[side].totalCents
    mutate(data[side].lines[0])
    assert.equal(data[side].lines[0].lineTotalCents, originalMoney)
    assert.equal(data[side].totalCents, originalRoot)
    assert.equal(comparisonMatchesVisibleBaskets(data.comparison, data.baseline, data.candidate), false)
  })
}

test('actual BasketView hides fabricated better-title when pack amount drifts', async () => {
  const { baseline, candidate, comparison } = pair(190)
  candidate.lines[0].pack = { ...candidate.lines[0].pack, amount: 10 }

  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  try {
    const { BasketView } = await vite.ssrLoadModule('/src/features/basket/BasketView.tsx')
    const html = renderToStaticMarkup(createElement(BasketView, {
      basket: baseline, comparison, comparisonBaseline: baseline, comparisonCandidate: candidate,
    }))
    assert.match(html, /Geen financieel verschil tonen/)
    assert.match(html, /Nog geen betrouwbare vergelijking/)
    assert.doesNotMatch(html, /Voorbeeldwinkel B ligt .* lager/)
    assert.doesNotMatch(html, /data-comparison-outcome="better"/)
  } finally {
    await vite.close()
  }
})
