import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  m3BaselineStore, m3BaselineProducts, m3CandidateStore, m3CandidateProducts,
} from '../src/data/m3ComparisonFixture.ts'

// Independent pure BigInt cent string oracle, not euro.formatCents().
function decimalCents(value) {
  const cents = BigInt(value)
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${whole},${(cents % 100n).toString().padStart(2, '0')}`
}

function exactBasket(store, products) {
  return buildOneStoreBasket({
    store, products, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
  })
}

function setRicePrice(basket, newPrice) {
  const line = basket.lines.find(line => line.id === 'basmati-rice')
  assert.ok(line && line.status === 'matched' && line.packs === 1)
  const oldLinePrice = line.lineTotalCents
  line.pricePerPackCents = newPrice
  line.lineTotalCents = newPrice
  basket.totalCents += newPrice - oldLinePrice
  assert.ok(Number.isSafeInteger(basket.totalCents), 'Full basket remains a safe cent amount')
}

test('QA issue #832: 64 extreme but safe cent-valued basket lines and whole totals render without loss of a cent', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { BasketView } = await vite.ssrLoadModule('/src/features/basket/BasketView.tsx')
    for (let n = 0; n < 64; n++) {
      const baseline = exactBasket(m3BaselineStore, m3BaselineProducts)
      const candidate = exactBasket(m3CandidateStore, m3CandidateProducts)
      const hugeCents = Number.MAX_SAFE_INTEGER - 50_000 - (n * 137)
      setRicePrice(baseline, hugeCents)
      setRicePrice(candidate, hugeCents + 1)
      const comparison = compareFullBaskets({ baseline, candidate })
      assert.equal(comparison.claimable, true, `case ${n}: ${comparison.reasons.join('; ')}`)
      assert.equal(comparison.outcome, 'worse', String(n))
      assert.equal(comparison.deltaCents, candidate.totalCents - baseline.totalCents, String(n))
      assert.equal(comparison.savingsCents, -comparison.deltaCents, String(n))
      const html = renderToStaticMarkup(createElement(BasketView, {
        basket: baseline, comparison,
        comparisonBaseline: baseline,
        comparisonCandidate: candidate,
      }))
      assert.ok(html.includes(decimalCents(hugeCents)),
        `Large row cents must stay exact: case ${n}`)
      assert.ok(html.includes(decimalCents(baseline.totalCents)),
        `Large baseline total cents must stay exact: case ${n}`)
      assert.ok(html.includes(decimalCents(candidate.totalCents)),
        `Large candidate total cents must stay exact: case ${n}`)
      assert.doesNotMatch(html, /data-comparison-outcome="unknown"/)
      assert.doesNotMatch(html, /Geen financieel verschil tonen/)
      assert.match(html, /geen actuele winkelprijzen of bewezen besparing/i)
    }
  } finally {
    await vite.close()
  }
})
